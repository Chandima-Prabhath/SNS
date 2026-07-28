import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createReadStream, statSync, existsSync, mkdirSync } from 'fs'
import { writeFile, readFile } from 'fs/promises'
import { Readable } from 'stream'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)

// Cache directory for downloaded audio files
const CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'music')

// Ensure the cache directory exists
function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/**
 * GET /api/music/stream/[videoId]
 *
 * Streams an audio file for a YouTube video. Uses a cache-first strategy:
 *   1. Check if the file is already cached on disk.
 *   2. If not, download it using yt-dlp + ffmpeg and save to cache.
 *   3. Serve the file with HTTP Byte-Range support (206 Partial Content)
 *      so the browser can seek instantly without re-downloading.
 *
 * Legal note: This extracts audio from YouTube for personal use within a
 * small friend group. YouTube's ToS technically prohibits this, but the
 * risk is low for a private app. For a production/public app, use licensed
 * sources like Jamendo or Audius instead.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { videoId } = await params
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

  ensureCacheDir()
  const filePath = path.join(CACHE_DIR, `${videoId}.mp3`)

  // Download the file if not cached
  if (!existsSync(filePath)) {
    try {
      await downloadAudio(videoId, filePath)
    } catch (e: any) {
      console.error(`[music/stream] download failed for ${videoId}:`, e)
      return NextResponse.json(
        { error: `Failed to download audio: ${e?.message || 'unknown'}` },
        { status: 502 }
      )
    }
  }

  // Serve the file with byte-range support
  const stat = statSync(filePath)
  const fileSize = stat.size
  const range = req.headers.get('range')

  if (range) {
    // Parse "bytes=start-end"
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
        'Cache-Control': 'public, max-age=86400', // cache for 24h
      },
    })
  }

  // No range header — return whole file
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
 * Download audio from YouTube using yt-dlp + ffmpeg.
 *
 * Extracts audio as MP3 at high quality and saves to the cache directory.
 * Uses cookies from the browser if available to avoid bot detection.
 *
 * Note: yt-dlp v2025.11.12+ requires an external JS runtime (Deno or Node.js)
 * for YouTube signature extraction. Deno is recommended.
 */
async function downloadAudio(videoId: string, outputPath: string): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${videoId}`

  // yt-dlp flags:
  //   -x              extract audio only
  //   --audio-format mp3   convert to MP3
  //   --audio-quality 0    highest VBR quality
  //   -o              output template (use temp file then rename)
  //   --no-playlist   don't download related playlist items
  //   --embed-thumbnail   add album art
  //   --add-metadata      add ID3 tags
  const tempOutput = outputPath.replace(/\.mp3$/, '.%(ext)s')

  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '-o', tempOutput,
    url,
  ]

  // Try with cookies if available (helps avoid bot detection)
  const cookiesPath = process.env.YTDLP_COOKIES_PATH
  if (cookiesPath && existsSync(cookiesPath)) {
    args.unshift('--cookies', cookiesPath)
  }

  console.log(`[music/stream] downloading ${videoId}...`)

  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
      timeout: 120000, // 2 minute timeout
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
    })

    // yt-dlp outputs to a temp file with the actual extension, then we
    // need to find and rename it. The temp file should be at outputPath
    // (since we specified .mp3 as the format).
    if (!existsSync(outputPath)) {
      // Try to find the output file (yt-dlp might have named it differently)
      const dir = path.dirname(outputPath)
      const files = await readFile(dir).catch(() => null)
      // If the file doesn't exist at the expected path, look for it
      throw new Error('yt-dlp did not produce the expected output file')
    }

    console.log(`[music/stream] downloaded ${videoId} → ${outputPath}`)
  } catch (e: any) {
    // If yt-dlp fails, try with a simpler command (no thumbnail/metadata)
    console.warn(`[music/stream] first attempt failed, trying simple: ${e.message}`)
    const simpleArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '-o', outputPath,
      url,
    ]
    if (cookiesPath && existsSync(cookiesPath)) {
      simpleArgs.unshift('--cookies', cookiesPath)
    }
    await execFileAsync('yt-dlp', simpleArgs, { timeout: 120000 })
    console.log(`[music/stream] downloaded ${videoId} (simple) → ${outputPath}`)
  }
}

// Disable static optimization — this route must always be dynamic
export const dynamic = 'force-dynamic'
