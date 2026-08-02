import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getYoutube, isValidVideoId, deduplicateTracks } from '@/lib/youtube'

// Simple per-user in-memory rate limit: max 30 music searches / minute.
// YouTube Music search is not free — each request hits the Innertube API,
// and a single user polling in a loop could trigger rate-limiting/quota
// exhaustion that affects everyone. Single-process Map; multi-instance
// deployments would need Redis or similar.
const SEARCH_RATE_LIMIT_MAX = 30
const SEARCH_RATE_LIMIT_WINDOW_MS = 60_000
interface SearchRateBucket { count: number; resetAt: number }
const searchRateBuckets = new Map<string, SearchRateBucket>()

function searchRateLimit(userId: string): boolean {
  const now = Date.now()
  const bucket = searchRateBuckets.get(userId)
  if (!bucket || now >= bucket.resetAt) {
    searchRateBuckets.set(userId, { count: 1, resetAt: now + SEARCH_RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (bucket.count >= SEARCH_RATE_LIMIT_MAX) {
    return false
  }
  bucket.count += 1
  return true
}

/**
 * GET /api/music/search?q=...
 *
 * Search YouTube Music for tracks. Returns an array of track objects:
 *   { videoId, title, artist, thumbnail, durationSeconds }
 *
 * Uses a cached youtubei.js instance for performance — the first request
 * creates the instance (~1-2s), subsequent requests reuse it (~instant).
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  if (!searchRateLimit(userId)) {
    return NextResponse.json(
      { error: 'rate limit exceeded — try again in a minute' },
      { status: 429 },
    )
  }

  const url = new URL(req.url)
  const query = url.searchParams.get('q')
  if (!query?.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }

  try {
    const youtube = await getYoutube()
    const searchResults = await youtube.music.search(query.trim(), { type: 'song' })

    // The search result has a .songs property (MusicShelf) when type='song'
    const songsShelf = (searchResults as any).songs
    const contents = songsShelf?.contents || (searchResults as any).contents || []

    const tracks = contents.map((item: any) => ({
      videoId: item.id,
      title: item.title || 'Unknown',
      artist: item.artists?.map((a: any) => a.name || a.text).join(', ') || 'Unknown',
      thumbnail: item.thumbnail?.contents?.[0]?.url || item.thumbnail?.[0]?.url || null,
      durationSeconds: item.duration?.seconds || null,
      album: item.album?.name || null,
    }))
      .filter((t: any) => isValidVideoId(t.videoId))

    const deduped = deduplicateTracks(tracks)

    return NextResponse.json({ tracks: deduped })
  } catch (e: any) {
    console.error('[music/search] error:', e?.message || e)
    return NextResponse.json(
      { error: 'internal error' },
      { status: 500 }
    )
  }
}
