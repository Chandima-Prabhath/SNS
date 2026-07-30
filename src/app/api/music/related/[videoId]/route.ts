import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getYoutube, isValidVideoId, deduplicateTracks } from '@/lib/youtube'

/**
 * GET /api/music/related/[videoId]
 *
 * Fetch related/recommended tracks for a given video using YouTube Music's
 * "Up Next" / radio feature. Used for autoplay when the current track ends.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { videoId } = await params
  if (!isValidVideoId(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
  }

  try {
    const youtube = await getYoutube()

    // getUpNext returns a PlaylistPanel with related videos
    const upNext = await youtube.music.getUpNext(videoId)
    const contents = upNext?.contents || []

    const tracks = contents.map((item: any) => {
      // PlaylistPanelVideo items have different property access
      return {
        videoId: item.videoId || item.id,
        title: item.title?.text || item.title || 'Unknown',
        artist: item.artists?.map((a: any) => a.name || a.text).join(', ') || 'Unknown',
        thumbnail: item.thumbnail?.[0]?.url || item.thumbnail?.contents?.[0]?.url || null,
        durationSeconds: item.duration?.seconds || item.duration_seconds || null,
      }
    }).filter((t: any) => isValidVideoId(t.videoId))

    const deduped = deduplicateTracks(tracks)

    return NextResponse.json({ tracks: deduped })
  } catch (e: any) {
    console.error('[music/related] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to fetch related tracks' },
      { status: 500 }
    )
  }
}
