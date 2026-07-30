import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createReadStream, statSync, existsSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

const CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'music')

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/**
 * Ensure the bgutil PO Token provider HTTP server is running on port 4416.
 *
 * Without the PO Token provider, YouTube blocks downloads with "Sign in to
 * confirm you're not a bot". We check if it's running and start it if not.
 */
let potProviderStarted = false
async function ensurePotProvider() {
  // Check if already running
  try {
    const res = await fetch('http://127.0.0.1:4416/health', { signal: AbortSignal.timeout(1000) })
    if (res.ok) return // already running
  } catch {
    // not running — start it
  }

  if (potProviderStarted) return // already tried, don't retry every request
  potProviderStarted = true

  console.log('[music/stream] starting PO Token provider...')
  try {
    const { spawn } = await import('child_process')
    const child = spawn('python3', ['-m', 'bgutil_ytdlp_pot_provider', '--port', '4416'], {
      detached: true,
      stdio: 'ignore',
      env: getYtDlpEnv(),
    })
    child.unref()
    console.log('[music/stream] PO Token provider started, waiting for it to be ready...')

    // Wait up to 10 seconds for it to be ready
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const res = await fetch('http://127.0.0.1:4416/health', { signal: AbortSignal.timeout(500) })
        if (res.ok) {
          console.log('[music/stream] PO Token provider is ready')
          return
        }
      } catch {
        // still starting
      }
    }
    console.warn('[music/stream] PO Token provider did not become ready in 10s')
  } catch (e: any) {
    console.error('[music/stream] failed to start PO Token provider:', e?.message)
  }
}

/**
 * Get the environment for yt-dlp, ensuring Deno is in PATH.
 *
 * The Next.js process may not have Deno in its PATH (it was installed via
 * the setup script which adds it to ~/.bashrc, but the server process was
 * started before that). We explicitly add ~/.deno/bin to PATH.
 */
function getYtDlpEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const denoBin = path.join(home, '.deno', 'bin')
  const env = { ...process.env }

  // Add Deno to PATH if it's not already there
  if (existsSync(denoBin) && !env.PATH?.includes(denoBin)) {
    env.PATH = `${denoBin}:${env.PATH || ''}`
  }

  return env
}

/**
 * GET /api/music/stream/[videoId]
 *
 * Streams audio from YouTube. Cache-first: if the file is already on disk,
 * serve it directly. Otherwise, download with yt-dlp and cache it.
 *
 * YouTube bot detection (2026 state):
 *   - The `web` client is SABR-blocked (no https formats)
 *   - The `android` client requires GVS PO Token and rejects cookies
 *   - yt-dlp needs Deno + yt-dlp-ejs to solve the "n challenge"
 *   - Default clients (tv, ios, web_safari, mweb) work best
 *
 * We do NOT force player_client — we let yt-dlp use its defaults.
 * We use `-f "ba/b"` which selects best audio, falling back to best stream.
 *
 * Server prerequisites (run scripts/setup-ytdlp.sh):
 *   pip install -U yt-dlp yt-dlp-ejs bgutil-ytdlp-pot-provider
 *   curl -fsSL https://deno.land/install.sh | sh
 *   apt install ffmpeg
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
    try {
      await downloadAudio(videoId, filePath)
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

/**
 * Download audio from YouTube using yt-dlp.
 *
 * CRITICAL: Do NOT force player_client=android or web. The android client
 * requires GVS PO Token and rejects cookies. The web client is SABR-blocked.
 * Let yt-dlp use its default clients (tv, ios, web_safari, mweb) which work.
 *
 * The format string "ba/b" selects best audio, falling back to best stream.
 * This is the most foolproof format string per 2026 research.
 *
 * Prerequisites (all required):
 *   - yt-dlp >= 2026.07.04 (pip install -U yt-dlp)
 *   - Deno >= 2.3.0 (for n-challenge solving)
 *   - yt-dlp-ejs >= 0.5.0 (pip install -U yt-dlp-ejs)
 *   - bgutil-ytdlp-pot-provider (pip install bgutil-ytdlp-pot-provider)
 *   - ffmpeg (apt install ffmpeg)
 *   - cookies.txt (set YTDLP_COOKIES_PATH in .env)
 */
async function downloadAudio(videoId: string, outputPath: string): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const cookiesPath = process.env.YTDLP_COOKIES_PATH
  const hasCookies = cookiesPath && existsSync(cookiesPath)

  if (hasCookies) {
    console.log(`[music/stream] using cookies from ${cookiesPath}`)
  } else {
    console.warn(`[music/stream] no cookies configured — YouTube may block downloads.`)
  }

  // Ensure the PO Token provider is running (needed to avoid bot detection)
  await ensurePotProvider()

  console.log(`[music/stream] downloading ${videoId}...`)

  // Build the command — minimal and foolproof.
  // Do NOT force player_client=android or web. Let yt-dlp use defaults.
  // The default clients (tv, ios, web_safari, mweb) work with PO Tokens.
  const args = [
    ...(hasCookies ? ['--cookies', cookiesPath!] : []),
    '-f', 'ba/b',                    // best audio, fallback to best
    '-x',                            // extract audio
    '--audio-format', 'mp3',         // convert to mp3
    '--audio-quality', '5',          // medium quality (smaller, faster)
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--retries', '3',                // retry on network errors
    '--fragment-retries', '3',       // retry fragments
    '--extractor-args', 'youtube:player_client=default,-android_sdkless',
    '-o', outputPath,
    url,
  ]

  console.log(`[music/stream] running: yt-dlp ${args.join(' ')}`)

  try {
    await execFileAsync('yt-dlp', args, {
      env: getYtDlpEnv(),
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    })

    if (existsSync(outputPath) && statSync(outputPath).size > 1000) {
      const size = statSync(outputPath).size
      console.log(`[music/stream] downloaded ${videoId} → ${outputPath} (${size} bytes)`)
      return
    }

    throw new Error('yt-dlp did not produce a valid output file')
  } catch (e: any) {
    const msg = e?.message || ''
    // If it's a format error, try ONE fallback with explicit format chain
    if (msg.includes('Requested format is not available')) {
      console.warn(`[music/stream] format not available, trying explicit chain...`)
      const fallbackArgs = [
        ...(hasCookies ? ['--cookies', cookiesPath!] : []),
        '-f', '251/250/234/233/140/bestaudio/best',
        '-x', '--audio-format', 'mp3', '--audio-quality', '5',
        '--no-playlist', '--no-warnings', '--no-progress',
        '-o', outputPath,
        url,
      ]
      try {
        await execFileAsync('yt-dlp', fallbackArgs, {
          env: getYtDlpEnv(),
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 10,
        })
        if (existsSync(outputPath) && statSync(outputPath).size > 1000) {
          console.log(`[music/stream] downloaded ${videoId} via fallback format chain`)
          return
        }
      } catch (e2: any) {
        console.error(`[music/stream] fallback also failed: ${e2?.message?.slice(0, 200)}`)
      }
    }
    throw e
  }
}

export const dynamic = 'force-dynamic'
