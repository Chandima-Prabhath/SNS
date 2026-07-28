import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import crypto from 'crypto'

const execFileAsync = promisify(execFile)

/**
 * GET /api/tts/voices — List the current user's custom voices.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const voices = await db.customVoice.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ voices })
}

/**
 * POST /api/tts/voices — Create a new custom voice from an uploaded audio clip.
 *
 * Body: { name: string, audioUrl: string }
 *
 * After saving the voice record, we run `pocket-tts export-voice` to convert
 * the audio clip into a .safetensors model file. This pre-computes the voice
 * embedding so that subsequent TTS generation is much faster (no need to
 * re-encode the audio through the Mimi codec each time).
 *
 * If the export fails (e.g., pocket-tts CLI not installed), we still save
 * the voice — it will use the slower voice_wav path as a fallback.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { name, audioUrl } = await req.json()

  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!audioUrl?.trim()) return NextResponse.json({ error: 'audioUrl required' }, { status: 400 })

  // Create the voice record first
  const voice = await db.customVoice.create({
    data: {
      ownerId: userId,
      name: name.trim(),
      audioUrl: audioUrl.trim(),
    },
  })

  // Try to export the voice to safetensors for fast inference.
  // This runs in the background — the client doesn't wait for it.
  exportSafetensors(voice.id, audioUrl).catch((e) => {
    console.error(`[tts-voices] safetensors export failed for ${voice.id}:`, e)
  })

  return NextResponse.json({ voice })
}

/**
 * Run `pocket-tts export-voice` to convert an audio clip to a .safetensors
 * voice model. On success, updates the CustomVoice record with the
 * safetensorsUrl. On failure, the voice remains usable via the slower
 * voice_wav path.
 */
async function exportSafetensors(voiceId: string, audioUrl: string) {
  // Resolve the audio file path (audioUrl is like "/uploads/abc.wav")
  const audioPath = path.join(process.cwd(), 'public', audioUrl)

  // Generate the safetensors file path
  const safetensorsFilename = `voice-${voiceId}.safetensors`
  const safetensorsPath = path.join(process.cwd(), 'public', 'uploads', safetensorsFilename)
  const safetensorsUrl = `/uploads/${safetensorsFilename}`

  // Try to run pocket-tts export-voice
  // The command is: pocket-tts export-voice <audio-path> <export-path>
  try {
    const { stdout, stderr } = await execFileAsync('pocket-tts', [
      'export-voice',
      audioPath,
      safetensorsPath,
    ], {
      timeout: 120000, // 2 minute timeout — encoding can take a while
    })

    console.log(`[tts-voices] safetensors export succeeded for ${voiceId}`)

    // Update the voice record with the safetensors URL
    await db.customVoice.update({
      where: { id: voiceId },
      data: { safetensorsUrl },
    })
  } catch (e: any) {
    // Common failures:
    // - pocket-tts CLI not installed (ENOENT)
    // - Audio file not found
    // - Timeout
    console.warn(`[tts-voices] safetensors export failed for ${voiceId}:`, e?.message || e)
    // Voice remains usable via voice_wav fallback
  }
}
