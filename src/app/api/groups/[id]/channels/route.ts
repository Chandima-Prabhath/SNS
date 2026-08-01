import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * Create a new channel in a group.
 * Owner or admin can create channels of any type (text | voice | video).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: groupId } = await params
  const { name, type = 'text', topic } = await req.json()

  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!['text', 'voice', 'video'].includes(type)) {
    return NextResponse.json({ error: 'type must be text, voice, or video' }, { status: 400 })
  }

  // Verify the caller is a member with owner or admin role
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  })
  if (!membership) return NextResponse.json({ error: 'not a member' }, { status: 403 })
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json({ error: 'only owners and admins can create channels' }, { status: 403 })
  }

  // Get the highest order to append the new channel at the end
  const lastChannel = await db.channel.findFirst({
    where: { groupId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const order = (lastChannel?.order || 0) + 1

  const channel = await db.channel.create({
    data: {
      groupId,
      name: name.trim(),
      type,
      topic: topic?.trim() || null,
      order,
    },
  })

  // Add all group members to the new channel (so they can see it immediately)
  const groupMembers = await db.groupMember.findMany({
    where: { groupId },
    select: { userId: true, role: true },
  })
  for (const m of groupMembers) {
    await db.channelMember
      .create({
        data: {
          channelId: channel.id,
          userId: m.userId,
          role: m.role === 'owner' ? 'owner' : 'member',
        },
      })
      .catch(() => {}) // already a member — ignore
  }

  return NextResponse.json({ channel })
}
