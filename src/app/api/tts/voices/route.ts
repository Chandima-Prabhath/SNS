import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

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
 * The audioUrl is the path returned by /api/upload after the user uploads
 * a voice clip. We store it and use it as the `voice_wav` parameter when
 * calling Pocket TTS.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { name, audioUrl } = await req.json()

  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!audioUrl?.trim()) return NextResponse.json({ error: 'audioUrl required' }, { status: 400 })

  const voice = await db.customVoice.create({
    data: {
      ownerId: userId,
      name: name.trim(),
      audioUrl: audioUrl.trim(),
    },
  })

  return NextResponse.json({ voice })
}
