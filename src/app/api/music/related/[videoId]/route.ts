import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getYoutube, isValidVideoId, deduplicateTracks } from '@/lib/youtube'

/**
 * GET /api/music/related/[videoId]
 *
 * Fetch related/recommended tracks for a given video using YouTube Music's
 * "Up Next" / radio feature. Used for autoplay when the current track ends.
 *
 * Tries getUpNext() first (the autoplay queue). If it returns too few tracks,
 * falls back to getRelated() (the related shelf). Both are v17-stable methods.
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
    const tracks: any[] = []

    // ── Primary: getUpNext (autoplay queue) ──────────────────────────────
    try {
      const upNext = await youtube.music.getUpNext(videoId)
      const contents = upNext?.contents || []

      for (const itemRaw of contents) {
        const item = itemRaw as any
        // PlaylistPanelVideo uses snake_case video_id.
        // PlaylistPanelVideoWrapper wraps it as .playlist_panel_video.video_id
        const id = item.video_id ?? item.playlist_panel_video?.video_id ?? item.videoId ?? item.id
        if (!isValidVideoId(id)) continue

        tracks.push({
          videoId: id,
          title: item.title?.text || item.title || 'Unknown',
          artist: item.artists?.map((a: any) => a.name || a.text).join(', ') || 'Unknown',
          thumbnail: item.thumbnail?.[0]?.url || item.thumbnail?.contents?.[0]?.url || null,
          durationSeconds: item.duration?.seconds || item.duration_seconds || null,
        })
      }
    } catch (e: any) {
      console.error('[music/related] getUpNext failed, trying getRelated:', e?.message || e)
    }

    // ── Fallback: getRelated (related shelf) if Up Next was empty ────────
    if (tracks.length < 3) {
      try {
        const related = await youtube.music.getRelated(videoId)
        // getRelated returns a SectionList | Message
        if (related && 'sections' in related) {
          for (const section of (related as any).sections || []) {
            for (const item of section?.contents || []) {
              const id = item.video_id ?? item.id ?? item.videoId
              if (!isValidVideoId(id)) continue

              // Avoid duplicates with Up Next tracks
              if (tracks.some((t) => t.videoId === id)) continue

              tracks.push({
                videoId: id,
                title: item.title?.text || item.title || 'Unknown',
                artist: item.artists?.map((a: any) => a.name || a.text).join(', ') || 'Unknown',
                thumbnail: item.thumbnail?.[0]?.url || item.thumbnail?.contents?.[0]?.url || null,
                durationSeconds: item.duration?.seconds || item.duration_seconds || null,
              })
            }
          }
        }
      } catch (e: any) {
        console.error('[music/related] getRelated also failed:', e?.message || e)
      }
    }

    // Remove the seed video itself from the results
    const filtered = tracks.filter((t) => t.videoId !== videoId)
    const deduped = deduplicateTracks(filtered)

    return NextResponse.json({ tracks: deduped })
  } catch (e: any) {
    console.error('[music/related] error:', e)
    // Graceful failure — return empty tracks so autoplay can stop cleanly
    return NextResponse.json({ tracks: [] })
  }
}
