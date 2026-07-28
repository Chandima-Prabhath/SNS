import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * DELETE /api/tts/voices/[id] — Delete a custom voice.
 * Only the owner can delete their own voices.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const voice = await db.customVoice.findUnique({ where: { id } })
  if (!voice) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (voice.ownerId !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await db.customVoice.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
