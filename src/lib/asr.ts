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
 * Audio format: any format ffmpeg/librosa can read (WAV, MP3, OGG, WebM/Opus,
 * M4A, FLAC). The Python server resamples to 16kHz mono internally.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

export interface AsrResult {
  text: string
  duration_sec: number
  model: string
  precision: string
  language: string
  processing_ms: number
}

/**
 * Transcribe an audio file given its absolute filesystem path.
 *
 * Returns the transcript text, or null if transcription failed (server down,
 * file missing, etc.). Callers should handle null gracefully — e.g. the bot
 * node falls back to "(transcription unavailable)".
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

  // Read file into a Buffer and build a Blob for multipart upload.
  // We don't stream because most voice messages are < 1MB.
  let fileBuffer: Buffer
  try {
    fileBuffer = await readFile(filePath)
  } catch (e: any) {
    console.error('[asr] failed to read file:', e?.message || e)
    return null
  }

  if (fileBuffer.length === 0) {
    console.error('[asr] empty audio file:', filePath)
    return null
  }

  // Determine a reasonable filename + MIME for the upload.
  const ext = path.extname(filePath).toLowerCase() || '.wav'
  const mimeMap: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
  }
  const mimeType = mimeMap[ext] || 'application/octet-stream'

  // Build multipart form — using FormData + Blob is the modern Node 18+ way.
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType })
  formData.append('audio', blob, `audio${ext}`)
  formData.append('language', language)

  try {
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

    return data
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.error('[asr] transcription timed out (>60s)')
    } else {
      console.error('[asr] fetch failed:', e?.message || e)
    }
    return null
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
