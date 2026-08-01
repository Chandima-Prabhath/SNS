import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if (session.user.role !== 'admin' && session.user.role !== 'owner') return null
  return session
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const groups = await db.group.findMany({
    include: {
      owner: { select: { id: true, username: true, displayName: true } },
      channels: {
        include: {
          _count: { select: { members: true, messages: true } },
        },
      },
      _count: { select: { channels: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ groups })
}

// Create a channel in an existing group (admin)
export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { groupId, name, type = 'text' } = await req.json()
  if (!groupId || !name) return NextResponse.json({ error: 'groupId and name required' }, { status: 400 })

  const order = await db.channel.count({ where: { groupId } })
  const channel = await db.channel.create({
    data: { groupId, name, type, order },
  })

  // Add all existing members of the group's other channels to this new channel
  const existingMembers = await db.channelMember.findMany({
    where: { channel: { groupId } },
    distinct: ['userId'],
    select: { userId: true, role: true },
  })
  if (existingMembers.length > 0) {
    await db.channelMember.createMany({
      data: existingMembers.map((m) => ({ channelId: channel.id, userId: m.userId, role: m.role })),
    })
  }

  return NextResponse.json({ channel })
}
