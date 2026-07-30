import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)

// Force this route to always run on the Node.js runtime as a dynamic route.
// In production builds, Next.js can otherwise try to inline/optimize route
// handlers in ways that break streaming responses. These two exports ensure
// the route always streams correctly in `next start` / PM2 / Node.js prod.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/tts — Generate a voice message using PocketBase TTS (Kyutai pocket-tts).
 *
 * Body: { text: string, voice?: string, customVoiceId?: string }
 *   - voice: a built-in voice name (alba, charles, etc.) — passed as voice_url
 *   - customVoiceId: ID of a user-created CustomVoice — passed as voice_wav
 *
 * Returns: a STREAMED audio/wav response body. The TTS server's response is
 * piped straight back to the client without buffering — the browser can start
 * playback as soon as the first bytes arrive (this is what the official
 * Pocket TTS web UI does to feel "instantaneous").
 *
 * We do NOT save the audio to disk in this route. The client receives the
 * WAV stream, plays it instantly via Web Audio API, AND collects the chunks
 * into a Blob. When the user clicks "Send", the client uploads that Blob to
 * /api/upload (which saves synchronously and returns a URL). This avoids the
 * race condition where a background save hadn't finished writing before the
 * message URL was accessed — which caused 0-length audio in production.
 *
 * The TTS service is expected to be running on the VM at the URL specified
 * by the TTS_URL environment variable (default: http://localhost:8000).
 * We proxy through this route to:
 *   - Keep the VM URL private (not exposed to the client)
 *   - Avoid CORS issues
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

    if (customVoiceId) {
      // Custom voice — load the user's voice model / clip from the DB.
      const customVoice = await db.customVoice.findUnique({
        where: { id: customVoiceId },
      })
      if (!customVoice || customVoice.ownerId !== userId) {
        return NextResponse.json({ error: 'custom voice not found' }, { status: 404 })
      }

      if (customVoice.safetensorsUrl) {
        // Fast path: pass the safetensors URL as voice_url. The Pocket TTS
        // server detects the .safetensors extension and loads tensors
        // directly instead of running the audio through the Mimi encoder.
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3090'
        formData.append('voice_url', `${baseUrl}${customVoice.safetensorsUrl}`)
      } else {
        // Slow path: pass the raw audio file as voice_wav.
        // IMPORTANT: Pocket TTS expects a valid WAV file (RIFF header).
        // If the uploaded file is webm/mp3/m4a, convert it to WAV with ffmpeg.
        // customVoice.audioUrl may be "/uploads/xxx" (legacy) or "/api/uploads/xxx" (new)
        const normalizedAudioUrl = customVoice.audioUrl.replace(/^\/api\/uploads\//, '/uploads/')
        const audioPath = path.join(process.cwd(), 'public', normalizedAudioUrl)
        if (!existsSync(audioPath)) {
          return NextResponse.json({ error: 'voice clip file not found' }, { status: 404 })
        }

        const wavBuffer = await ensureWav(audioPath)
        const audioBlob = new Blob([wavBuffer as BlobPart], { type: 'audio/wav' })
        formData.append('voice_wav', audioBlob, 'voice.wav')
      }
    } else {
      // Built-in voice — pass the voice NAME as voice_url. This uses the
      // server's pre-built voices (fast). We deliberately do NOT pass
      // voice_wav here — that would trigger the slow voice-cloning path.
      formData.append('voice_url', voice)
    }

    console.log(`[tts] calling TTS server at ${ttsUrl}/tts with voice=${customVoiceId ? 'custom' : voice}, text=${truncatedText.length} chars`)
    const ttsStartTime = Date.now()

    const ttsRes = await fetch(`${ttsUrl}/tts`, {
      method: 'POST',
      body: formData,
    })

    console.log(`[tts] TTS server response headers received in ${Date.now() - ttsStartTime}ms (status: ${ttsRes.status})`)

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

    // Stream the TTS server's response directly to the client. The TTS server
    // uses StreamingResponse — it sends the WAV header immediately and streams
    // audio chunks as they're generated. The client reads this stream to:
    //   1. Play audio instantly via Web Audio API (~200ms to first sound)
    //   2. Collect all chunks into a Blob for later upload on send
    //
    // We do NOT save to disk here. Previously we used body.tee() to save in
    // the background, but that created a race condition in production: the
    // client would send the message URL before the background write finished,
    // resulting in 0-length audio. Now the client uploads the Blob via
    // /api/upload when sending — that route saves synchronously and only
    // returns the URL after the file is fully on disk.
    return new Response(ttsRes.body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
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
