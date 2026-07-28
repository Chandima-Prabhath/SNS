import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Innertube } from 'youtubei.js'

/**
 * GET /api/music/trending
 *
 * Fetch trending music tracks from YouTube Music.
 * Returns an array of track objects in the same format as /api/music/search.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const youtube = await Innertube.create()
    const trending = await youtube.music.getTrending()

    const tracks = (trending.contents || []).map((item: any) => ({
      videoId: item.id,
      title: item.title?.text || 'Unknown',
      artist: item.authors?.[0]?.name || item.artists?.[0]?.text || 'Unknown',
      thumbnail: item.thumbnail?.[0]?.url || null,
      durationSeconds: item.duration_seconds || null,
    })).filter((t: any) => t.videoId)

    return NextResponse.json({ tracks })
  } catch (e: any) {
    console.error('[music/trending] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to fetch trending' },
      { status: 500 }
    )
  }
}
