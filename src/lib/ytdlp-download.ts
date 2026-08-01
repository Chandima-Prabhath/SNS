/**
 * Shared yt-dlp audio download logic.
 *
 * Used by both:
 *   - /api/music/stream/[videoId] (serves the audio to the client)
 *   - /api/music/predownload/[videoId] (pre-fetches audio for queue items)
 *
 * Extracted here so the predownload route can call it directly instead of
 * doing a wasteful HTTP loopback to the stream route (which had a port-
 * mismatch bug and blocked for the full download duration).
 */

import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, statSync } from 'fs'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

export const CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'music')

export function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/**
 * Get the environment for yt-dlp, ensuring Deno is in PATH.
 * The Next.js process may not have Deno in its PATH (installed via ~/.bashrc).
 */
export function getYtDlpEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const denoBin = path.join(home, '.deno', 'bin')
  const env = { ...process.env }
  if (existsSync(denoBin) && !env.PATH?.includes(denoBin)) {
    env.PATH = `${denoBin}:${env.PATH || ''}`
  }
  return env
}

/**
 * Ensure the bgutil PO Token provider HTTP server is running on port 4416.
 * Without it, YouTube blocks downloads with "Sign in to confirm you're not a bot".
 */
let potProviderStarted = false
let potProviderStarting: Promise<void> | null = null

export async function ensurePotProvider() {
  // Check if already running
  try {
    const res = await fetch('http://127.0.0.1:4416/health', { signal: AbortSignal.timeout(1000) })
    if (res.ok) return
  } catch {
    // not running
  }

  if (potProviderStarted) return
  if (potProviderStarting) return potProviderStarting

  potProviderStarting = (async () => {
    console.log('[ytdlp] starting PO Token provider...')
    try {
      const child = spawn('python3', ['-m', 'bgutil_ytdlp_pot_provider', '--port', '4416'], {
        detached: true,
        stdio: 'ignore',
        env: getYtDlpEnv(),
      })
      child.unref()

      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        try {
          const res = await fetch('http://127.0.0.1:4416/health', { signal: AbortSignal.timeout(500) })
          if (res.ok) {
            console.log('[ytdlp] PO Token provider is ready')
            potProviderStarted = true
            return
          }
        } catch {
          // still starting
        }
      }
      console.warn('[ytdlp] PO Token provider did not become ready in 10s')
    } catch (e: any) {
      console.error('[ytdlp] failed to start PO Token provider:', e?.message)
    } finally {
      potProviderStarting = null
    }
  })()

  return potProviderStarting
}

/**
 * Check if a video is already cached on disk.
 */
export function isCached(videoId: string): boolean {
  const filePath = path.join(CACHE_DIR, `${videoId}.mp3`)
  return existsSync(filePath) && statSync(filePath).size > 1000
}

// ─── Shared in-flight download tracker ──────────────────────────────────────
// Prevents duplicate concurrent downloads of the same videoId. Shared across
// the stream route, predownload route, and the server-side music:sync preload
// hook. Uses globalThis so it survives hot-reloads in dev mode.
const globalForDownloads = globalThis as unknown as {
  __adoo_downloadInFlight?: Map<string, Promise<void>>
}
const inFlight: Map<string, Promise<void>> =
  globalForDownloads.__adoo_downloadInFlight || new Map()
globalForDownloads.__adoo_downloadInFlight = inFlight

/** Check if a download is currently in progress for this videoId. */
export function isDownloading(videoId: string): boolean {
  return inFlight.has(videoId)
}

/**
 * Get an existing download promise, or start a new one.
 *
 * This is the single entry point for downloading audio — used by:
 *   - /api/music/stream/[videoId] (serves the audio)
 *   - /api/music/predownload/[videoId] (client-triggered prefetch)
 *   - realtime-server.ts music:sync hook (server-side proactive preload)
 *
 * Deduplicates concurrent downloads of the same videoId — if two callers
 * request the same video, only one yt-dlp process runs; both await the
 * same promise.
 *
 * @returns A Promise that resolves when the download is complete (or
 *          immediately if already cached). The promise REJECTS on failure.
 */
export function getOrCreateDownload(videoId: string): Promise<void> {
  // Already cached — resolve immediately
  if (isCached(videoId)) return Promise.resolve()

  // Already downloading — return the existing promise
  if (inFlight.has(videoId)) return inFlight.get(videoId)!

  // Start a new download
  ensureCacheDir()
  const filePath = path.join(CACHE_DIR, `${videoId}.mp3`)
  const downloadPromise = downloadAudio(videoId, filePath)
    .finally(() => inFlight.delete(videoId))

  inFlight.set(videoId, downloadPromise)
  return downloadPromise
}

/**
 * Download audio from YouTube using yt-dlp.
 *
 * CRITICAL: Do NOT force player_client=android or web. Let yt-dlp use its
 * default clients (tv, ios, web_safari, mweb) which work with PO Tokens.
 *
 * @throws Error with a descriptive message if the download fails.
 */
export async function downloadAudio(videoId: string, outputPath: string): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const cookiesPath = process.env.YTDLP_COOKIES_PATH
  const hasCookies = cookiesPath && existsSync(cookiesPath)

  if (hasCookies) {
    console.log(`[ytdlp] using cookies from ${cookiesPath}`)
  }

  await ensurePotProvider()

  console.log(`[ytdlp] downloading ${videoId}...`)

  const args = [
    ...(hasCookies ? ['--cookies', cookiesPath!] : []),
    '-f', 'ba/b',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--retries', '3',
    '--fragment-retries', '3',
    '--extractor-args', 'youtube:player_client=default,-android_sdkless',
    '-o', outputPath,
    url,
  ]

  try {
    await execFileAsync('yt-dlp', args, {
      env: getYtDlpEnv(),
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    })

    if (existsSync(outputPath) && statSync(outputPath).size > 1000) {
      const size = statSync(outputPath).size
      console.log(`[ytdlp] downloaded ${videoId} → ${outputPath} (${size} bytes)`)
      return
    }

    throw new Error('yt-dlp did not produce a valid output file')
  } catch (e: any) {
    const msg = e?.message || ''
    if (msg.includes('Requested format is not available')) {
      console.warn(`[ytdlp] format not available, trying explicit chain...`)
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
          console.log(`[ytdlp] downloaded ${videoId} via fallback format chain`)
          return
        }
      } catch (e2: any) {
        console.error(`[ytdlp] fallback also failed: ${e2?.message?.slice(0, 200)}`)
      }
    }
    throw e
  }
}
