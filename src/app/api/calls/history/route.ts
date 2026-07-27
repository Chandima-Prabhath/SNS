import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/calls/history
 * Returns the user's call history (calls they participated in).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const calls = await db.voiceCall.findMany({
    where: {
      participants: { some: { userId } },
    },
    include: {
      participants: {
        include: {
          user: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
        },
      },
      starter: {
        select: { id: true, username: true, displayName: true },
      },
      channel: {
        select: { id: true, name: true, group: { select: { name: true, isDm: true, partner: true } } },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: 30,
  })

  return NextResponse.json({ calls })
}
