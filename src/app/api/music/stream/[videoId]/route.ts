import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createReadStream, statSync, existsSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)

const CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'music')

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/**
 * GET /api/music/stream/[videoId]
 *
 * Streams audio from YouTube. Cache-first: if the file is already on disk,
 * serve it directly. Otherwise, download with yt-dlp + ffmpeg and cache it.
 *
 * YouTube bot detection: YouTube blocks yt-dlp by default. We use cookies
 * (if configured via YTDLP_COOKIES_PATH) and the android player to avoid
 * detection. If cookies aren't set, the user gets a clear error message.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { videoId } = await params
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

  // Validate the video ID — must be exactly 11 alphanumeric chars
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
    try {
      await downloadAudio(videoId, filePath)
    } catch (e: any) {
      console.error(`[music/stream] download failed for ${videoId}:`, e?.message || e)
      const errorMsg = e?.message || 'unknown error'
      // Provide a user-friendly error for common YouTube blocking issues
      if (errorMsg.includes('Sign in to confirm') || errorMsg.includes('not a bot')) {
        return NextResponse.json(
          { error: 'YouTube is blocking downloads. Set YTDLP_COOKIES_PATH in .env to fix this. See .env.example for instructions.' },
          { status: 502 }
        )
      }
      if (errorMsg.includes('Video unavailable')) {
        return NextResponse.json(
          { error: 'This video is unavailable. It may have been removed or is region-locked.' },
          { status: 404 }
        )
      }
      return NextResponse.json(
        { error: `Failed to download audio: ${errorMsg}` },
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

/**
 * Download audio from YouTube using yt-dlp.
 *
 * Key flags:
 *   --extract-audio --audio-format mp3   convert to MP3
 *   --audio-quality 5                    medium quality (smaller files, faster)
 *   --no-playlist                        don't follow playlist entries
 *   --cookies                            use cookies if configured (avoids bot detection)
 *   --extractor-args "youtube:player_client=android"  use android client (less bot detection)
 */
async function downloadAudio(videoId: string, outputPath: string): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${videoId}`

  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--extractor-args', 'youtube:player_client=android',
    '-o', outputPath,
    url,
  ]

  // Add cookies if configured — this is ESSENTIAL for avoiding YouTube's
  // "Sign in to confirm you're not a bot" block.
  const cookiesPath = process.env.YTDLP_COOKIES_PATH
  if (cookiesPath && existsSync(cookiesPath)) {
    args.unshift('--cookies', cookiesPath)
    console.log(`[music/stream] using cookies from ${cookiesPath}`)
  } else {
    console.warn(`[music/stream] no cookies configured — YouTube may block downloads. Set YTDLP_COOKIES_PATH in .env`)
  }

  console.log(`[music/stream] downloading ${videoId}...`)

  const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 10,
  })

  if (!existsSync(outputPath)) {
    throw new Error('yt-dlp did not produce the expected output file')
  }

  console.log(`[music/stream] downloaded ${videoId} → ${outputPath} (${statSync(outputPath).size} bytes)`)
}

export const dynamic = 'force-dynamic'
