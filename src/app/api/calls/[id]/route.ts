import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Join a call
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: callId } = await params

  await db.callParticipant.upsert({
    where: { callId_userId: { callId, userId } },
    create: { callId, userId },
    update: { leftAt: null },
  })

  const call = await db.voiceCall.findUnique({
    where: { id: callId },
    include: {
      participants: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } },
    },
  })
  return NextResponse.json({ call })
}

// Leave / end a call
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: callId } = await params

  await db.callParticipant.updateMany({
    where: { callId, userId },
    data: { leftAt: new Date() },
  })

  // If no participants remain, mark call ended
  const remaining = await db.callParticipant.count({
    where: { callId, leftAt: null },
  })
  if (remaining === 0) {
    await db.voiceCall.update({
      where: { id: callId },
      data: { status: 'ended', endedAt: new Date() },
    })
  }

  return NextResponse.json({ ok: true, ended: remaining === 0 })
}
