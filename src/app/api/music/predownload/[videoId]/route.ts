import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getOrCreateDownload, isDownloading, isCached } from '@/lib/ytdlp-download'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/music/predownload/[videoId]
 *
 * Pre-downloads a track to the server cache so it's ready to play instantly
 * when the user gets to it in the queue.
 *
 * FIRE-AND-FORGET: Returns 202 (Accepted) immediately and runs the download
 * in the background. This is the foolproof approach — the client doesn't
 * wait 10-30 seconds for yt-dlp to finish, and the download continues even
 * if the client navigates away or the connection drops.
 *
 * Uses the shared getOrCreateDownload() from ytdlp-download.ts, which
 * deduplicates concurrent downloads of the same videoId across ALL callers
 * (stream route, predownload route, and the server-side music:sync preload
 * hook). If the same video is requested again while a download is in
 * progress, the second request returns 202 immediately.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { videoId } = await params
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
  }

  // Already cached — return immediately
  if (isCached(videoId)) {
    return NextResponse.json({ cached: true, videoId, status: 'cached' })
  }

  // Check if download is already in flight
  if (isDownloading(videoId)) {
    // Already downloading — return 202, don't start a duplicate
    return NextResponse.json({ cached: false, videoId, status: 'downloading' }, { status: 202 })
  }

  // Start the download in the background (fire-and-forget)
  console.log(`[predownload] starting background download for ${videoId}`)
  getOrCreateDownload(videoId)
    .then(() => console.log(`[predownload] ✓ download complete for ${videoId}`))
    .catch((e: any) => console.error(`[predownload] ✗ failed for ${videoId}:`, e?.message || e))

  // Return 202 immediately — the download continues in the background
  return NextResponse.json({ cached: false, videoId, status: 'downloading' }, { status: 202 })
}

/**
 * GET /api/music/predownload/[videoId]
 *
 * Check the predownload status for a video. Returns:
 *   - { cached: true } if the file is on disk and ready to play
 *   - { cached: false, downloading: true } if currently downloading
 *   - { cached: false, downloading: false } if not downloading (failed or never started)
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { videoId } = await params
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
  }

  if (isCached(videoId)) {
    return NextResponse.json({ cached: true, videoId })
  }

  return NextResponse.json({
    cached: false,
    videoId,
    downloading: isDownloading(videoId),
  })
}
