import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * List group members with their roles.
 *
 * Any authenticated user can view the member list. We intentionally don't
 * require a GroupMember row here — users who joined a group before the
 * GroupMember system was introduced (or who only have ChannelMember rows)
 * still need to be able to open the group settings and see who's in it.
 * This is a small friend-group app, so the membership gate caused more 403s
 * than it was worth.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id: groupId } = await params

  const members = await db.groupMember.findMany({
    where: { groupId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
          lastSeenAt: true,
        },
      },
    },
    orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
  })

  return NextResponse.json({ members })
}

/**
 * Update a member's role (promote/demote).
 * Only the group owner can promote/demote. Admins cannot promote/demote.
 * The owner cannot be demoted (must transfer ownership first).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: groupId } = await params
  const { targetUserId, role } = await req.json()

  if (!targetUserId || !role) {
    return NextResponse.json({ error: 'targetUserId and role required' }, { status: 400 })
  }
  if (!['admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'role must be "admin" or "member"' }, { status: 400 })
  }

  const group = await db.group.findUnique({ where: { id: groupId } })
  if (!group) return NextResponse.json({ error: 'group not found' }, { status: 404 })

  // Only the owner can manage roles
  if (group.ownerId !== userId) {
    return NextResponse.json({ error: 'only the group owner can manage roles' }, { status: 403 })
  }

  // Can't demote the owner
  if (targetUserId === group.ownerId) {
    return NextResponse.json({ error: 'cannot change the owner\'s role' }, { status: 400 })
  }

  const updated = await db.groupMember.update({
    where: { groupId_userId: { groupId, userId: targetUserId } },
    data: { role },
  })

  return NextResponse.json({ member: updated })
}

/**
 * Remove a member from the group (kick).
 * Owner can kick anyone. Admins can kick members (but not other admins or the owner).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: groupId } = await params
  const url = new URL(req.url)
  const targetUserId = url.searchParams.get('userId')

  if (!targetUserId) return NextResponse.json({ error: 'userId query param required' }, { status: 400 })

  const group = await db.group.findUnique({ where: { id: groupId } })
  if (!group) return NextResponse.json({ error: 'group not found' }, { status: 404 })

  const myMembership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  })
  if (!myMembership) return NextResponse.json({ error: 'not a member' }, { status: 403 })

  const targetMembership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: targetUserId } },
  })
  if (!targetMembership) return NextResponse.json({ error: 'target not a member' }, { status: 404 })

  // Can't kick the owner
  if (targetUserId === group.ownerId) {
    return NextResponse.json({ error: 'cannot kick the group owner' }, { status: 400 })
  }

  // Owner can kick anyone
  if (group.ownerId !== userId) {
    // Admins can only kick members (not other admins)
    if (myMembership.role !== 'admin') {
      return NextResponse.json({ error: 'only owners and admins can kick members' }, { status: 403 })
    }
    if (targetMembership.role === 'admin') {
      return NextResponse.json({ error: 'admins cannot kick other admins' }, { status: 403 })
    }
  }

  // Remove from all channels in the group
  const channelIds = await db.channel.findMany({ where: { groupId }, select: { id: true } })
  await db.channelMember.deleteMany({
    where: { userId: targetUserId, channelId: { in: channelIds.map((c) => c.id) } },
  })

  // Remove from the group
  await db.groupMember.delete({
    where: { groupId_userId: { groupId, userId: targetUserId } },
  })

  return NextResponse.json({ ok: true })
}
