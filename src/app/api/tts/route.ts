import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * POST /api/tts — Generate a voice message using PocketBase TTS (Kyutai pocket-tts).
 *
 * Body: { text: string, voice?: string }
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

    const { text, voice = 'alba' } = await req.json()

    if (!text?.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 })
    }

    // Cap text length to prevent abuse — 500 chars is about 30s of speech
    const truncatedText = text.slice(0, 500)

    const ttsUrl = process.env.TTS_URL || 'http://localhost:8000'
    console.log(`[tts] generating speech: "${truncatedText.slice(0, 50)}..." with voice ${voice}`)

    // Call the Pocket TTS API — multipart form with text and voice_url
    const formData = new FormData()
    formData.append('text', truncatedText)
    formData.append('voice_url', voice)

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
      voice,
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
