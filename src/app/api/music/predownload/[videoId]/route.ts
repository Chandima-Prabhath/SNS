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
 * Calls downloadAudio() directly (no HTTP loopback) — fixes the previous bug
 * where the hardcoded port 3090 caused ECONNREFUSED on dev (port 3000) and
 * wasted resources by downloading the full file via a 1-byte range request.
 *
 * Deduplicates concurrent requests for the same videoId via an in-flight map.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { videoId } = await params
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
  }

  // Already cached — return immediately
  if (isCached(videoId)) {
    return NextResponse.json({ cached: true, videoId })
  }

  // Check if download is already in flight
  let downloadPromise = inFlight.get(videoId)
  if (!downloadPromise) {
    ensureCacheDir()
    const filePath = path.join(CACHE_DIR, `${videoId}.mp3`)
    downloadPromise = downloadAudio(videoId, filePath)
      .catch((e) => {
        console.error(`[predownload] failed for ${videoId}:`, e?.message || e)
        // Don't rethrow — we want the promise to resolve so subsequent
        // requests can retry. The error is logged.
      })
      .finally(() => {
        inFlight.delete(videoId)
      })
    inFlight.set(videoId, downloadPromise)
    console.log(`[predownload] started download for ${videoId}`)
  } else {
    console.log(`[predownload] dedup — already downloading ${videoId}`)
  }

  // Wait for the download to complete
  await downloadPromise

  if (isCached(videoId)) {
    return NextResponse.json({ cached: true, videoId })
  }

  return NextResponse.json({ cached: false, error: 'Download failed' }, { status: 502 })
}
