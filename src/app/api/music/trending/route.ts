import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Innertube } from 'youtubei.js'

/**
 * GET /api/music/trending
 *
 * Fetch trending/new music from YouTube Music.
 *
 * Note: youtubei.js v17.0.0 removed getTrending() because YouTube removed
 * the aggregated trending feed. We use getExplore() instead, which returns
 * carousel shelves of new releases, trending songs, and more.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const youtube = await Innertube.create()
    const explore = await youtube.music.getExplore()

    const tracks: any[] = []

    // Iterate through the carousel shelves (New releases, Trending, etc.)
    for (const shelf of explore.sections || []) {
      const sectionTitle = shelf.header?.title?.toString() || ''
      for (const item of shelf.contents || []) {
        // Handle both MusicTwoRowItem and MusicResponsiveListItem
        if (item.is?.('MusicTwoRowItem')) {
          if (item.id) {
            tracks.push({
              videoId: item.id,
              title: item.title?.toString() || 'Unknown',
              artist: item.subtitle?.toString() || 'Unknown',
              thumbnail: item.thumbnail?.[0]?.url || null,
              durationSeconds: null,
              section: sectionTitle,
            })
          }
        } else if (item.is?.('MusicResponsiveListItem')) {
          if (item.id) {
            tracks.push({
              videoId: item.id,
              title: item.title || 'Unknown',
              artist: item.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
              thumbnail: item.thumbnail?.contents?.[0]?.url || null,
              durationSeconds: item.duration?.seconds || null,
              section: sectionTitle,
            })
          }
        } else if (item.id) {
          // Fallback — try to extract common properties
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

    // Filter to only tracks with videoIds (some items might be albums/artists)
    const validTracks = tracks.filter((t) => t.videoId && t.videoId.length > 4)

    return NextResponse.json({ tracks: validTracks.slice(0, 50) })
  } catch (e: any) {
    console.error('[music/trending] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to fetch trending' },
      { status: 500 }
    )
  }
}
