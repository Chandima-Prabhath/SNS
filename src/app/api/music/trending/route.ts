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
        const node = item as any
        if (node.is?.('MusicTwoRowItem')) {
          tracks.push({
            videoId: node.id,
            title: node.title?.toString() || 'Unknown',
            artist: node.subtitle?.toString() || 'Unknown',
            thumbnail: node.thumbnail?.[0]?.url || null,
            durationSeconds: null,
            section: sectionTitle,
          })
        } else if (node.is?.('MusicResponsiveListItem')) {
          tracks.push({
            videoId: node.id,
            title: node.title || 'Unknown',
            artist: node.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
            thumbnail: node.thumbnail?.contents?.[0]?.url || null,
            durationSeconds: node.duration?.seconds || null,
            section: sectionTitle,
          })
        } else if (node.id) {
          tracks.push({
            videoId: node.id,
            title: node.title?.toString?.() || node.title || 'Unknown',
            artist: node.subtitle?.toString?.() || node.artists?.map?.((a: any) => a.name).join(', ') || 'Unknown',
            thumbnail: node.thumbnail?.[0]?.url || node.thumbnail?.contents?.[0]?.url || null,
            durationSeconds: node.duration?.seconds || null,
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
    // Graceful failure — return empty tracks so the UI can fall back to
    // home feed instead of showing an error. This matches the home route's
    // pattern and prevents react-query from marking the query as broken.
    return NextResponse.json({ tracks: [] })
  }
}
