import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import crypto from 'crypto'

const execFileAsync = promisify(execFile)

/**
 * POST /api/tts — Generate a voice message using PocketBase TTS (Kyutai pocket-tts).
 *
 * Body: { text: string, voice?: string, customVoiceId?: string }
 *   - voice: a built-in voice name (alba, charles, etc.) — passed as voice_url
 *   - customVoiceId: ID of a user-created CustomVoice — passed as voice_wav
 *
 * Returns: { url: string } — the URL of the generated WAV file saved to /uploads/
 *
 * The TTS service is expected to be running on the VM at the URL specified
 * by the TTS_URL environment variable (default: http://localhost:8000).
 * We proxy through this route to:
 *   - Keep the VM URL private (not exposed to the client)
 *   - Avoid CORS issues
 *   - Save the audio file to public/uploads/ so it can be served statically
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
    console.log(`[tts] generating speech: "${truncatedText.slice(0, 50)}..." with voice ${voice}`)

    // Build the multipart form for Pocket TTS
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
        console.log(`[tts] using safetensors voice: ${customVoice.name}`)
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
        console.log(`[tts] using raw audio voice (no safetensors yet): ${customVoice.name}`)
      }
    } else {
      // Use a built-in voice name
      formData.append('voice_url', voice)
    }

    const ttsRes = await fetch(`${ttsUrl}/tts`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type — the browser/fetch sets it with the boundary
    })

    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => 'unknown error')
      console.error('[tts] TTS service error:', ttsRes.status, errText)
      return NextResponse.json(
        { error: `TTS service error: ${ttsRes.status}` },
        { status: 502 }
      )
    }

    // The response is a streaming WAV file. Save it to public/uploads/.
    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer())

    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }

    const filename = `tts-${crypto.randomUUID()}.wav`
    const filePath = path.join(uploadDir, filename)
    await writeFile(filePath, audioBuffer)

    console.log(`[tts] saved ${filename} (${audioBuffer.length} bytes)`)

    return NextResponse.json({
      url: `/uploads/${filename}`,
      type: 'audio',
      text: truncatedText,
      voice: customVoiceId ? 'custom' : voice,
      size: audioBuffer.length,
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
