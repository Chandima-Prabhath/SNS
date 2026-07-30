import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getYoutube, isValidVideoId, deduplicateTracks } from '@/lib/youtube'

/**
 * GET /api/music/trending
 *
 * Fetch trending/new music from YouTube Music.
 * Uses getExplore() (getTrending was removed in youtubei.js v17).
 * Uses a cached youtubei.js instance for performance.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const youtube = await getYoutube()
    const explore = await youtube.music.getExplore()

    const tracks: any[] = []

    for (const shelf of explore.sections || []) {
      const sectionTitle = shelf.header?.title?.toString() || ''
      for (const item of shelf.contents || []) {
        if (item.is?.('MusicTwoRowItem')) {
          tracks.push({
            videoId: item.id,
            title: item.title?.toString() || 'Unknown',
            artist: item.subtitle?.toString() || 'Unknown',
            thumbnail: item.thumbnail?.[0]?.url || null,
            durationSeconds: null,
            section: sectionTitle,
          })
        } else if (item.is?.('MusicResponsiveListItem')) {
          tracks.push({
            videoId: item.id,
            title: item.title || 'Unknown',
            artist: item.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
            thumbnail: item.thumbnail?.contents?.[0]?.url || null,
            durationSeconds: item.duration?.seconds || null,
            section: sectionTitle,
          })
        } else if (item.id) {
          tracks.push({
            videoId: item.id,
            title: item.title?.toString?.() || item.title || 'Unknown',
            artist: item.subtitle?.toString?.() || item.artists?.map?.((a: any) => a.name).join(', ') || 'Unknown',
            thumbnail: item.thumbnail?.[0]?.url || item.thumbnail?.contents?.[0]?.url || null,
            durationSeconds: item.duration?.seconds || null,
            section: sectionTitle,
          })
        }
      }
    }

    // Filter to only valid video IDs and deduplicate
    const validTracks = tracks.filter((t) => isValidVideoId(t.videoId))
    const deduped = deduplicateTracks(validTracks)

    return NextResponse.json({ tracks: deduped.slice(0, 50) })
  } catch (e: any) {
    console.error('[music/trending] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to fetch trending' },
      { status: 500 }
    )
  }
}
