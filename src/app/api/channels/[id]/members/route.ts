import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// List members of a channel
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id: channelId } = await params

  const members = await db.channelMember.findMany({
    where: { channelId },
    include: {
      user: {
        select: { id: true, username: true, displayName: true, avatarUrl: true, status: true, customStatus: true },
      },
    },
  })
  return NextResponse.json({
    members: members.map((m) => ({ ...m.user, role: m.role, joinedAt: m.joinedAt })),
  })
}
