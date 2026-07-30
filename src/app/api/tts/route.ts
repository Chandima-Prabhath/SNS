import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import crypto from 'crypto'

const execFileAsync = promisify(execFile)

// Cache the upload-dir-exists check so we don't stat() on every request.
let uploadDirEnsured = false

/**
 * POST /api/tts — Generate a voice message using PocketBase TTS (Kyutai pocket-tts).
 *
 * Body: { text: string, voice?: string, customVoiceId?: string }
 *   - voice: a built-in voice name (alba, charles, etc.) — passed as voice_url
 *   - customVoiceId: ID of a user-created CustomVoice — passed as voice_wav
 *
 * Returns: a STREAMED audio/wav response body (so the client can start
 * playback immediately) plus an `X-Tts-Url` response header pointing at the
 * saved file in /uploads/ (which is written to disk in the background while
 * the client receives the stream).
 *
 * The TTS service is expected to be running on the VM at the URL specified
 * by the TTS_URL environment variable (default: http://localhost:8000).
 * We proxy through this route to:
 *   - Keep the VM URL private (not exposed to the client)
 *   - Avoid CORS issues
 *   - Save the audio file to public/uploads/ so it can be served statically
 *
 * Performance notes:
 *   - For built-in voices we only append `text` + `voice_url` to the form —
 *     no file reads, no ffmpeg, no extra work before calling the TTS server.
 *     `voice_url` uses the server's pre-built voices (fast). We NEVER pass
 *     `voice_wav` for built-in voices (that would trigger voice cloning).
 *   - We stream the TTS response straight through to the client instead of
 *     buffering it with `arrayBuffer()` first. The stream is teed: one branch
 *     goes to the client (low TTFB, playback can start immediately), the other
 *     is piped to a file write stream in the background. The client receives
 *     the final URL in the `X-Tts-Url` header so it can send the message
 *     without waiting for the disk write to finish.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const userId = (session.user as any).id

    const { text, voice = 'alba', customVoiceId } = await req.json()

    if (!text?.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 })
    }

    // Cap text length to prevent abuse — 500 chars is about 30s of speech
    const truncatedText = text.slice(0, 500)

    const ttsUrl = process.env.TTS_URL || 'http://localhost:8000'

    // Build the multipart form for Pocket TTS — single allocation, appended
    // exactly once per field (no redundant re-creation).
    const formData = new FormData()
    formData.append('text', truncatedText)

    // If a custom voice ID is provided, check for a safetensors model first
    // (fast path — just loads tensors, no PyTorch compute). Fall back to the
    // raw audio clip (slow path — runs the Mimi encoder) if no safetensors
    // model has been exported yet.
    if (customVoiceId) {
      const customVoice = await db.customVoice.findUnique({
        where: { id: customVoiceId },
      })
      if (!customVoice || customVoice.ownerId !== userId) {
        return NextResponse.json({ error: 'custom voice not found' }, { status: 404 })
      }

      if (customVoice.safetensorsUrl) {
        // Fast path: pass the safetensors URL as voice_url. The Pocket TTS
        // server detects the .safetensors extension and loads tensors directly
        // instead of running the audio through the Mimi encoder.
        // We need to pass an absolute URL since the TTS server needs to
        // download it. Use the app's public URL or localhost.
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3090'
        formData.append('voice_url', `${baseUrl}${customVoice.safetensorsUrl}`)
      } else {
        // Slow path: pass the raw audio file as voice_wav.
        // IMPORTANT: Pocket TTS expects a valid WAV file (RIFF header).
        // If the uploaded file is webm/mp3/m4a, we must convert it to WAV
        // using ffmpeg first.
        const audioPath = path.join(process.cwd(), 'public', customVoice.audioUrl)
        if (!existsSync(audioPath)) {
          return NextResponse.json({ error: 'voice clip file not found' }, { status: 404 })
        }

        const wavBuffer = await ensureWav(audioPath)
        const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' })
        formData.append('voice_wav', audioBlob, 'voice.wav')
      }
    } else {
      // Built-in voice — pass the voice NAME as voice_url. This uses the
      // server's pre-built voices (fast). We deliberately do NOT pass
      // voice_wav here — that would trigger the slow voice-cloning path.
      formData.append('voice_url', voice)
    }

    const ttsRes = await fetch(`${ttsUrl}/tts`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type — fetch sets it with the multipart boundary
    })

    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => 'unknown error')
      console.error('[tts] TTS service error:', ttsRes.status, errText)
      return NextResponse.json(
        { error: `TTS service error: ${ttsRes.status}` },
        { status: 502 }
      )
    }

    if (!ttsRes.body) {
      return NextResponse.json(
        { error: 'TTS service returned no body' },
        { status: 502 }
      )
    }

    // Decide the final URL + on-disk path up front so we can return the URL
    // in a header and start writing the file while the client streams audio.
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    if (!uploadDirEnsured && !existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }
    uploadDirEnsured = true

    const filename = `tts-${crypto.randomUUID()}.wav`
    const filePath = path.join(uploadDir, filename)
    const fileUrl = `/uploads/${filename}`

    // Tee the TTS response: one branch streams to the client (immediate
    // playback), the other is piped to a file write stream in the background
    // (so the file is ready by the time the user clicks "send").
    const [clientStream, diskStream] = ttsRes.body.tee()

    streamToFile(diskStream, filePath).catch((e) => {
      console.error('[tts] background save failed:', e)
    })

    // Stream the WAV straight back to the client. The URL of the saved file
    // is sent in the `X-Tts-Url` header so the client can send the message
    // with that URL (the file is written in the background while the client
    // receives + previews the audio).
    return new Response(clientStream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'X-Tts-Url': fileUrl,
        'X-Tts-Text': encodeURIComponent(truncatedText),
        'X-Tts-Voice': customVoiceId ? 'custom' : voice,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    console.error('[tts] error:', e)
    return NextResponse.json(
      { error: e?.message || 'TTS generation failed' },
      { status: 500 }
    )
  }
}

/**
 * Pipe a ReadableStream of bytes to a file on disk (streaming write — chunks
 * are flushed as they arrive so the file is ready almost as soon as the last
 * byte is received). Used to save the TTS audio in the background.
 */
async function streamToFile(stream: ReadableStream<Uint8Array>, filePath: string) {
  const { createWriteStream } = await import('fs')
  const writeStream = createWriteStream(filePath)
  const reader = stream.getReader()
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        writeStream.write(value)
      }
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
  } finally {
    writeStream.destroy()
  }
}

/**
 * GET /api/tts/voices — List available TTS voices.
 * These are the pre-built voices from Pocket TTS (Kyutai).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Pre-built voices from Pocket TTS
  const voices = [
    { id: 'alba', name: 'Alba', language: 'English', gender: 'female' },
    { id: 'anna', name: 'Anna', language: 'English', gender: 'female' },
    { id: 'charles', name: 'Charles', language: 'English', gender: 'male' },
    { id: 'george', name: 'George', language: 'English', gender: 'male' },
    { id: 'jane', name: 'Jane', language: 'English', gender: 'female' },
    { id: 'michael', name: 'Michael', language: 'English', gender: 'male' },
    { id: 'paul', name: 'Paul', language: 'English', gender: 'male' },
    { id: 'peter_yearsley', name: 'Peter', language: 'English', gender: 'male' },
    { id: 'stuart_bell', name: 'Stuart', language: 'English', gender: 'male' },
    { id: 'vera', name: 'Vera', language: 'English', gender: 'female' },
    { id: 'estelle', name: 'Estelle', language: 'French', gender: 'female' },
    { id: 'giovanni', name: 'Giovanni', language: 'Italian', gender: 'male' },
    { id: 'juergen', name: 'Juergen', language: 'German', gender: 'male' },
    { id: 'lola', name: 'Lola', language: 'Spanish', gender: 'female' },
    { id: 'rafael', name: 'Rafael', language: 'Portuguese', gender: 'male' },
  ]

  return NextResponse.json({ voices })
}

/**
 * Ensure an audio file is in WAV format (RIFF header).
 *
 * Pocket TTS's voice_wav parameter expects a valid WAV file. Browser
 * recordings from MediaRecorder produce audio/webm, and uploaded files
 * might be mp3/m4a/ogg. We use ffmpeg to convert any audio format to
 * 16-bit PCM WAV at 24kHz mono (Pocket TTS's expected format).
 *
 * If the file is already a WAV, we return it as-is.
 * If ffmpeg is not available, we return the original file (will fail at
 * the TTS server with a clear RIFF error).
 */
async function ensureWav(audioPath: string): Promise<Buffer> {
  // Check if the file is already a WAV by reading the first 4 bytes
  const header = await readFile(audioPath, { encoding: null }).then((buf) => buf.subarray(0, 4).toString('ascii'))
  if (header === 'RIFF') {
    // Already a WAV — return as-is
    return readFile(audioPath)
  }

  // Not a WAV — convert with ffmpeg
  const tempWavPath = audioPath.replace(/\.[^.]+$/, '') + `_converted.wav`
  try {
    console.log(`[tts] converting audio to WAV: ${audioPath} → ${tempWavPath}`)
    await execFileAsync('ffmpeg', [
      '-y',               // overwrite output
      '-i', audioPath,    // input
      '-ar', '24000',     // 24kHz sample rate (Pocket TTS default)
      '-ac', '1',         // mono
      '-acodec', 'pcm_s16le', // 16-bit PCM
      tempWavPath,
    ], { timeout: 30000 })

    const wavBuffer = await readFile(tempWavPath)

    // Clean up temp file
    await import('fs/promises').then((fs) => fs.unlink(tempWavPath).catch(() => {}))

    return wavBuffer
  } catch (e: any) {
    console.error('[tts] ffmpeg conversion failed:', e?.message || e)
    // Return original file — the TTS server will give a clearer error
    return readFile(audioPath)
  }
}
