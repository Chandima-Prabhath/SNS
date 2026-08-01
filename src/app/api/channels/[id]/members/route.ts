import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// List members of a channel — requires membership
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: channelId } = await params

  // Verify the caller is a member of this channel
  const membership = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'not a member of this channel' }, { status: 403 })
  }

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

// Leave a channel (remove own membership) — used by the chat list context menu
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: channelId } = await params

  // Don't let the group owner leave their own channel via this route —
  // they should use the group settings to delete the channel instead.
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { group: true },
  })
  if (!channel) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (channel.group.ownerId === userId) {
    return NextResponse.json({ error: 'owners cannot leave their own channel' }, { status: 403 })
  }

  await db.channelMember.deleteMany({
    where: { channelId, userId },
  })

  return NextResponse.json({ ok: true })
}
