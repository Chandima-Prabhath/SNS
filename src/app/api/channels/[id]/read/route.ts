import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Mark a message as read by this user
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: channelId } = await params
  const { messageId } = await req.json()

  // Authorization: caller must be a member of this channel
  const membership = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await db.messageReadReceipt.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId },
    update: {},
  })

  // Update lastReadMessageId on the membership
  await db.channelMember.update({
    where: { channelId_userId: { channelId, userId } },
    data: { lastReadMessageId: messageId },
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
