import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Innertube } from 'youtubei.js'

/**
 * GET /api/music/search?q=...
 *
 * Search YouTube Music for tracks. Returns an array of track objects:
 *   { videoId, title, artist, thumbnail, durationSeconds }
 *
 * Uses youtubei.js (the most actively maintained YouTube Music scraper).
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const query = url.searchParams.get('q')
  if (!query?.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }

  try {
    const youtube = await Innertube.create()
    const searchResults = await youtube.music.search(query.trim(), { type: 'song' })

    const tracks = (searchResults.songs?.contents || []).map((item: any) => ({
      videoId: item.id,
      title: item.title?.text || 'Unknown',
      artist: item.artists?.map((a: any) => a.text).join(', ') || 'Unknown',
      thumbnail: item.thumbnail?.[0]?.url || null,
      durationSeconds: item.duration_seconds || null,
      album: item.album?.text || null,
    })).filter((t: any) => t.videoId)

    return NextResponse.json({ tracks })
  } catch (e: any) {
    console.error('[music/search] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Search failed' },
      { status: 500 }
    )
  }
}
