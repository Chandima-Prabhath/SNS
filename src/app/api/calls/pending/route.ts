import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/calls/pending
 *
 * Returns any active calls where the user is NOT yet a participant
 * but SHOULD be (they were rang via call:ring).
 *
 * Used when the app opens from a notification — the call:incoming
 * socket event was missed because the app was closed. This endpoint
 * lets the app discover pending calls on load.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  // Find active calls in channels where the user is a member,
  // but where the user is NOT a participant yet
  const calls = await db.voiceCall.findMany({
    where: {
      status: 'active',
      // User is NOT a participant
      participants: {
        none: { userId },
      },
      // The call is in a channel the user is a member of
      channel: {
        members: { some: { userId } },
      },
    },
    include: {
      starter: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      participants: {
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      },
      channel: {
        select: {
          id: true,
          name: true,
          group: { select: { name: true, isDm: true } },
        },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: 5,
  })

  // Filter: only return calls started in the last 60 seconds
  // (older calls are likely abandoned)
  const now = Date.now()
  const recentCalls = calls.filter((c) => {
    const age = now - new Date(c.startedAt).getTime()
    return age < 60_000 // 60 seconds
  })

  return NextResponse.json({ calls: recentCalls })
}
