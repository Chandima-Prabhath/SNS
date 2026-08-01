import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createReadStream, statSync, existsSync } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import { getOrCreateDownload, isDownloading, isCached, ensureCacheDir, CACHE_DIR } from '@/lib/ytdlp-download'

/**
 * GET /api/music/stream/[videoId]
 *
 * Streams audio from YouTube. Cache-first: if the file is already on disk,
 * serve it directly. Otherwise, download with yt-dlp and cache it.
 *
 * If a download is already in progress (started by the predownload route or
 * the server-side music:sync preload hook), returns 202 + Retry-After so the
 * client's <audio> element can retry instead of holding a connection open.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { videoId } = await params
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: 'Invalid video ID. This might be an album or playlist ID, not a track.' },
      { status: 400 }
    )
  }

  ensureCacheDir()
  const filePath = path.join(CACHE_DIR, `${videoId}.mp3`)

  // Download the file if not cached
  if (!existsSync(filePath)) {
    // If a download is already in progress, tell the client to retry in 2s.
    // This prevents blocking the HTTP connection for 10-30s while yt-dlp runs.
    if (isDownloading(videoId)) {
      return new NextResponse(null, {
        status: 202,
        headers: {
          'Retry-After': '2',
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-store',
        },
      })
    }

    // Not cached, not downloading — start the download and await it
    try {
      await getOrCreateDownload(videoId)
    } catch (e: any) {
      console.error(`[music/stream] download failed for ${videoId}:`, e?.message || e)
      const errorMsg = e?.message || 'unknown error'
      if (errorMsg.includes('Sign in to confirm') || errorMsg.includes('not a bot')) {
        return NextResponse.json(
          { error: 'YouTube is blocking downloads. Ensure yt-dlp, Deno, yt-dlp-ejs, and cookies are set up. Run scripts/setup-ytdlp.sh on the server.' },
          { status: 502 }
        )
      }
      if (errorMsg.includes('Video unavailable')) {
        return NextResponse.json(
          { error: 'This video is unavailable. It may have been removed or is region-locked.' },
          { status: 404 }
        )
      }
      if (errorMsg.includes('Requested format is not available')) {
        return NextResponse.json(
          { error: 'Could not extract audio. Run scripts/setup-ytdlp.sh to install yt-dlp-ejs and Deno — these are required for YouTube audio extraction in 2026.' },
          { status: 502 }
        )
      }
      return NextResponse.json(
        { error: `Failed to download audio: ${errorMsg.slice(0, 150)}` },
        { status: 502 }
      )
    }
  }

  // Serve the file with byte-range support
  const stat = statSync(filePath)
  const fileSize = stat.size
  const range = req.headers.get('range')

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    const stream = createReadStream(filePath, { start, end })
    const webStream = Readable.toWeb(stream) as ReadableStream

    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  }

  const stream = createReadStream(filePath)
  const webStream = Readable.toWeb(stream) as ReadableStream
  return new Response(webStream, {
    headers: {
      'Content-Length': fileSize.toString(),
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

export const dynamic = 'force-dynamic'
