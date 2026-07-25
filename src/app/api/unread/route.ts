import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/unread
 *
 * Returns unread message counts per channel for the current user.
 * A message is "unread" if it was created after the user's lastReadMessageId
 * on that channel's membership, AND it wasn't sent by the user themselves.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const memberships = await db.channelMember.findMany({
    where: { userId },
    select: {
      channelId: true,
      lastReadMessageId: true,
    },
  })

  const unread: Record<string, number> = {}

  for (const m of memberships) {
    let lastReadCreatedAt = new Date(0)
    if (m.lastReadMessageId) {
      const lastRead = await db.message.findUnique({
        where: { id: m.lastReadMessageId },
        select: { createdAt: true },
      })
      if (lastRead) lastReadCreatedAt = lastRead.createdAt
    }

    const count = await db.message.count({
      where: {
        channelId: m.channelId,
        createdAt: { gt: lastReadCreatedAt },
        senderId: { not: userId },
        senderType: 'user',
        deletedAt: null,
      },
    })
    if (count > 0) unread[m.channelId] = count
  }

  const total = Object.values(unread).reduce((a, b) => a + b, 0)
  return NextResponse.json({ unread, total })
}
