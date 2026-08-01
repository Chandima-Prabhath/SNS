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
  const userId = session.user.id

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
  const userId = session.user.id
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
 *
 * IMPORTANT: Pocket TTS expects WAV files (RIFF header). Browser recordings
 * produce audio/webm, and uploaded files might be mp3/m4a. We convert the
 * audio to WAV using ffmpeg before passing it to pocket-tts.
 */
async function exportSafetensors(voiceId: string, audioUrl: string) {
  // Resolve the audio file path. audioUrl may be "/uploads/abc.wav" (legacy)
  // or "/api/uploads/abc.wav" (new) — both point to public/uploads/abc.wav.
  const normalizedUrl = audioUrl.replace(/^\/api\/uploads\//, '/uploads/')
  const audioPath = path.join(process.cwd(), 'public', normalizedUrl)

  // Convert to WAV first (pocket-tts requires WAV format)
  const wavPath = await ensureWavFile(audioPath)

  // Generate the safetensors file path
  const safetensorsFilename = `voice-${voiceId}.safetensors`
  const safetensorsPath = path.join(process.cwd(), 'public', 'uploads', safetensorsFilename)
  // Use /api/uploads/ so the TTS server can fetch it through our dedicated
  // file-serving route (bypasses Next.js static file caching in production).
  const safetensorsUrl = `/api/uploads/${safetensorsFilename}`

  // Try to run pocket-tts export-voice
  try {
    const { stdout, stderr } = await execFileAsync('pocket-tts', [
      'export-voice',
      wavPath,
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
    console.warn(`[tts-voices] safetensors export failed for ${voiceId}:`, e?.message || e)
    // Voice remains usable via voice_wav fallback
  } finally {
    // Clean up the temporary WAV file if it was converted
    if (wavPath !== audioPath) {
      await import('fs/promises').then((fs) => fs.unlink(wavPath).catch(() => {}))
    }
  }
}

/**
 * Ensure an audio file is in WAV format. If it's already WAV, return the
 * original path. Otherwise, convert to WAV using ffmpeg and return the
 * temp file path.
 */
async function ensureWavFile(audioPath: string): Promise<string> {
  const { readFile } = await import('fs/promises')
  const header = await readFile(audioPath).then((buf) => buf.subarray(0, 4).toString('ascii'))
  if (header === 'RIFF') {
    return audioPath // already WAV
  }

  // Convert to WAV
  const wavPath = audioPath.replace(/\.[^.]+$/, '') + `_converted.wav`
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', audioPath,
      '-ar', '24000',
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      wavPath,
    ], { timeout: 30000 })
    return wavPath
  } catch (e: any) {
    console.error('[tts-voices] ffmpeg conversion failed:', e?.message || e)
    return audioPath // return original — will fail with a clear error
  }
}
