import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { downloadAudio, ensureCacheDir, isCached, CACHE_DIR } from '@/lib/ytdlp-download'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Track in-flight downloads to avoid duplicate work when the client fires
// multiple predownload requests for the same video (e.g. on queue changes)
const inFlight = new Map<string, Promise<void>>()

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
 * Deduplicates concurrent requests for the same videoId via an in-flight map.
 * If the same video is requested again while a download is in progress, the
 * second request returns 202 immediately (the in-flight download will serve
 * both).
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
  if (inFlight.has(videoId)) {
    // Already downloading — return 202, don't start a duplicate
    return NextResponse.json({ cached: false, videoId, status: 'downloading' }, { status: 202 })
  }

  // Start the download in the background (fire-and-forget)
  ensureCacheDir()
  const filePath = path.join(CACHE_DIR, `${videoId}.mp3`)
  console.log(`[predownload] starting background download for ${videoId}`)

  const downloadPromise = downloadAudio(videoId, filePath)
    .then(() => {
      console.log(`[predownload] ✓ download complete for ${videoId}`)
    })
    .catch((e: any) => {
      console.error(`[predownload] ✗ failed for ${videoId}:`, e?.message || e)
    })
    .finally(() => {
      inFlight.delete(videoId)
    })

  inFlight.set(videoId, downloadPromise)

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
 *
 * The client can poll this to check if a predownload finished.
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
    downloading: inFlight.has(videoId),
  })
}
