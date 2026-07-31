/**
 * Moonshine ASR (speech-to-text) client.
 *
 * Talks to the Python sidecar at process.env.ASR_URL (default
 * http://localhost:8001). That sidecar loads the Moonshine ONNX model
 * once and exposes a POST /asr endpoint.
 *
 * Used by:
 *   - The `asr_transcribe` bot builder node (via framework.ts → transcribeAudio)
 *   - Auto-transcription when a voice message is uploaded to a channel
 *   - POST /api/asr (manual client-triggered transcription)
 *
 * Audio format handling:
 *   Voice messages from MediaRecorder are WebM/Opus. The Python server uses
 *   librosa + PySoundFile (libsndfile) to load audio — but libsndfile doesn't
 *   support WebM/Opus, so it falls back to `audioread` (ffmpeg-based), which
 *   is slower and produces garbage quality that Moonshine can't transcribe.
 *
 *   FIX: We convert any non-WAV file to 16kHz mono WAV on the Node.js side
 *   using ffmpeg BEFORE sending it to the Python server. This guarantees
 *   PySoundFile can load it natively — fast, reliable, no fallbacks.
 *   Moonshine requires 16kHz (unlike TTS which uses 24kHz).
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { tmpdir } from 'os'
import crypto from 'crypto'

const execFileAsync = promisify(execFile)

export interface AsrResult {
  text: string
  duration_sec: number
  model: string
  precision: string
  language: string
  processing_ms: number
}

/**
 * Convert an audio file to 16kHz mono WAV using ffmpeg.
 *
 * Moonshine ASR requires 16kHz mono audio. Voice messages from the browser
 * are WebM/Opus (or sometimes MP4/AAC on Safari). libsndfile (PySoundFile)
 * can't decode WebM/Opus, so the Python server's librosa falls back to
 * `audioread` which produces garbage quality.
 *
 * This function converts ANY audio format to the exact format Moonshine
 * wants: 16kHz, mono, 16-bit PCM WAV. If the file is already a WAV, we still
 * re-encode to guarantee 16kHz mono (in case it's 48kHz stereo WAV).
 *
 * If ffmpeg is not available, returns null and the caller falls back to
 * sending the original file (which will likely fail at the Python server).
 *
 * @returns Path to the temp WAV file, or null if conversion failed.
 */
async function convertToWav16kMono(filePath: string): Promise<string | null> {
  // Generate a temp file path for the converted WAV
  const tempWavPath = path.join(tmpdir(), `asr-${crypto.randomUUID()}.wav`)

  try {
    // -y         = overwrite output if exists
    // -i         = input file
    // -af loudnorm=I=-16:TP=-1.5:LRA=11 — EBU R128 loudness normalization.
    //   This normalizes the audio to -16 LUFS (standard speech level) which
    //   dramatically improves Moonshine's accuracy on quiet recordings.
    //   Without this, Moonshine often returns "..." on quiet or uneven audio.
    // -ar 16000  = 16kHz sample rate (Moonshine requirement)
    // -ac 1      = mono
    // -acodec pcm_s16le = 16-bit PCM
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', filePath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar', '16000',
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      tempWavPath,
    ], { timeout: 30000 })

    return tempWavPath
  } catch (e: any) {
    console.error('[asr] ffmpeg conversion failed:', e?.message || e)
    // Clean up partial temp file if it exists
    try {
      const { unlink } = await import('fs/promises')
      await unlink(tempWavPath).catch(() => {})
    } catch {}
    return null
  }
}

/**
 * Transcribe an audio file given its absolute filesystem path.
 *
 * Returns the transcript text, or null if transcription failed (server down,
 * file missing, etc.). Callers should handle null gracefully — e.g. the bot
 * node falls back to "(transcription unavailable)".
 *
 * This function converts the audio to 16kHz mono WAV before sending it to
 * the Python ASR server, because:
 *   1. libsndfile (PySoundFile) can't decode WebM/Opus — the format browser
 *      voice messages use
 *   2. The audioread fallback produces garbage quality that Moonshine can't
 *      transcribe (returns "..." instead of real text)
 *   3. 16kHz mono is Moonshine's native format — no resampling needed on the
 *      Python side, faster transcription
 *
 * @param filePath  Absolute path to the audio file on disk.
 * @param language  Optional language code (currently ignored — Moonshine v1 is English-only).
 */
export async function transcribeAudioFile(
  filePath: string,
  language: string = 'en',
): Promise<AsrResult | null> {
  const asrUrl = process.env.ASR_URL || 'http://localhost:8001'

  if (!existsSync(filePath)) {
    console.error('[asr] file not found:', filePath)
    return null
  }

  // ── Convert to 16kHz mono WAV before sending ──────────────────────────
  // This is the critical fix — without it, WebM files produce garbage
  // transcriptions because librosa's audioread fallback doesn't decode
  // Opus correctly.
  const wavPath = await convertToWav16kMono(filePath)
  const sendPath = wavPath || filePath // fallback to original if ffmpeg fails

  try {
    // Read the (converted) WAV file
    let fileBuffer: Buffer
    try {
      fileBuffer = await readFile(sendPath)
    } catch (e: any) {
      console.error('[asr] failed to read file:', e?.message || e)
      return null
    }

    if (fileBuffer.length === 0) {
      console.error('[asr] empty audio file:', sendPath)
      return null
    }

    // Build multipart form — always send as audio/wav since we converted it
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'audio/wav' })
    formData.append('audio', blob, 'audio.wav')
    formData.append('language', language)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000) // 60s hard cap

    const res = await fetch(`${asrUrl}/asr`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '(no body)')
      console.error(`[asr] server error ${res.status}: ${errText.slice(0, 200)}`)
      return null
    }

    const data = (await res.json()) as AsrResult
    if (!data || typeof data.text !== 'string') {
      console.error('[asr] invalid response:', data)
      return null
    }

    // ── Garbage detection ──────────────────────────────────────────────
    // Moonshine sometimes returns garbage when it can't understand the audio:
    //   - "..." or "…" (dots — model confused by silence/noise)
    //   - "" (empty string — no speech detected)
    //   - "." (single dot)
    //   - Strings that are ONLY punctuation (no alphanumeric chars)
    //
    // These are technically "successful" transcriptions (HTTP 200) but the
    // text is useless. Treat them as failures so callers fall back to
    // "(transcription unavailable)" instead of showing garbage to users.
    const cleaned = data.text.trim()
    if (!cleaned || !/[a-zA-Z0-9]/.test(cleaned)) {
      console.warn(`[asr] garbage transcription detected: "${cleaned}" — treating as failure`)
      return null
    }

    return { ...data, text: cleaned }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.error('[asr] transcription timed out (>60s)')
    } else {
      console.error('[asr] fetch failed:', e?.message || e)
    }
    return null
  } finally {
    // Clean up the temp WAV file if we created one
    if (wavPath && wavPath !== filePath) {
      try {
        const { unlink } = await import('fs/promises')
        await unlink(wavPath).catch(() => {})
      } catch {}
    }
  }
}

/**
 * Convenience: transcribe an audio file given its public URL path
 * (e.g. "/api/uploads/voice-123.webm"). Resolves to the on-disk file.
 *
 * Returns just the transcript text (or null on failure).
 */
export async function transcribeMediaUrl(
  mediaUrl: string,
  language: string = 'en',
): Promise<string | null> {
  // Strip leading slash, build absolute filesystem path.
  // URLs look like "/api/uploads/voice-xxx.webm" → file at public/uploads/voice-xxx.webm
  const relativePath = mediaUrl
    .replace(/^\/api\/uploads\//, 'uploads/')
    .replace(/^\/uploads\//, 'uploads/')
    .replace(/^\//, '')

  const filePath = path.join(process.cwd(), 'public', relativePath)

  const result = await transcribeAudioFile(filePath, language)
  return result?.text?.trim() || null
}

/**
 * Check if the ASR server is reachable and the model is loaded.
 * Useful for health checks / "is transcription available?" UI badges.
 */
export async function checkAsrHealth(): Promise<{
  reachable: boolean
  loaded: boolean
  model?: string
  precision?: string
}> {
  const asrUrl = process.env.ASR_URL || 'http://localhost:8001'

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${asrUrl}/health`, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) return { reachable: false, loaded: false }
    const data = await res.json()
    return {
      reachable: true,
      loaded: !!data.loaded,
      model: data.model,
      precision: data.precision,
    }
  } catch {
    return { reachable: false, loaded: false }
  }
}
