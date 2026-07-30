import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getYoutube, isValidVideoId, deduplicateTracks } from '@/lib/youtube'
import type { Track } from '@/stores/useMusicStore'

/**
 * GET /api/music/home
 *
 * Personalized YouTube Music recommendations from getHomeFeed().
 *
 * Returns an array of grouped sections, each with a title (taken from the
 * shelf header, e.g. "Listen again", "Mixed for you", "New releases") and a
 * list of tracks. The MusicView renders each section as a horizontal row or
 * grid.
 *
 * If getHomeFeed() fails (e.g. YouTube returns a Sign In wall because we have
 * no cookies), we return an empty `sections` array so the client can silently
 * hide the "For You" area without breaking the page.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const youtube = await getYoutube()
    
    let home
    try {
      home = await youtube.music.getHomeFeed()
    } catch (e: any) {
      console.warn('[music/home] getHomeFeed failed, falling back to getExplore:', e?.message || e)
      // Fallback to getExplore (same as trending) if getHomeFeed fails
      const explore = await youtube.music.getExplore()
      home = explore
    }

    const sections: { title: string; tracks: Track[] }[] = []

    for (const shelf of (home as any).sections || []) {
      const sectionTitle: string = shelf.header?.title?.toString() || 'For You'
      const tracks: Track[] = []

      for (const item of shelf.contents || []) {
        if (item.is?.('MusicTwoRowItem')) {
          tracks.push({
            videoId: item.id,
            title: item.title?.toString() || 'Unknown',
            artist: item.subtitle?.toString() || 'Unknown',
            thumbnail: item.thumbnail?.[0]?.url || null,
            durationSeconds: null,
          })
        } else if (item.is?.('MusicResponsiveListItem')) {
          tracks.push({
            videoId: item.id,
            title: item.title || 'Unknown',
            artist: item.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
            thumbnail: item.thumbnail?.contents?.[0]?.url || null,
            durationSeconds: item.duration?.seconds || null,
          })
        } else if (item.id) {
          tracks.push({
            videoId: item.id,
            title: item.title?.toString?.() || item.title || 'Unknown',
            artist:
              item.subtitle?.toString?.() ||
              item.artists?.map?.((a: any) => a.name).join(', ') ||
              'Unknown',
            thumbnail: item.thumbnail?.[0]?.url || item.thumbnail?.contents?.[0]?.url || null,
            durationSeconds: item.duration?.seconds || null,
          })
        }
      }

      // Filter to only valid video IDs and deduplicate within this section.
      const valid = tracks.filter((t) => isValidVideoId(t.videoId))
      const deduped = deduplicateTracks(valid)

      if (deduped.length > 0) {
        sections.push({ title: sectionTitle, tracks: deduped })
      }
    }

    return NextResponse.json({ sections })
  } catch (e: any) {
    // Most failures here are "Sign in to YouTube" walls — log for debugging
    // but return an empty payload so the UI degrades gracefully.
    console.error('[music/home] error:', e?.message || e)
    return NextResponse.json({ sections: [] })
  }
}
