import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * Update a channel (rename, change topic).
 * Owner or admin can edit any channel.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: channelId } = await params
  const body = await req.json()
  const { name, topic } = body

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { group: true },
  })
  if (!channel) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Verify caller is owner or admin of the group
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: channel.groupId, userId } },
  })
  if (!membership) return NextResponse.json({ error: 'not a member' }, { status: 403 })
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json({ error: 'only owners and admins can edit channels' }, { status: 403 })
  }

  const data: any = {}
  if (typeof name === 'string' && name.trim()) data.name = name.trim()
  if (typeof topic === 'string') data.topic = topic.trim() || null

  const updated = await db.channel.update({ where: { id: channelId }, data })
  return NextResponse.json({ channel: updated })
}

/**
 * Delete a channel.
 *
 * - For DM channels (group.isDm === true): any member can delete the
 *   conversation. This deletes ALL messages, read receipts, and the
 *   channel itself (for both users). Also works for DMs with deleted
 *   users (the senderId on the membership may be null, but we check
 *   channel membership, not user existence).
 *
 * - For group channels: only the group owner or admin can delete.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: channelId } = await params

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { group: true },
  })
  if (!channel) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: channel.groupId, userId } },
  })
  if (!membership) return NextResponse.json({ error: 'not a member' }, { status: 403 })

  // For DM channels, any member can delete (deletes for both users).
  // For group channels, only owner/admin can delete.
  if (!channel.group.isDm) {
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json({ error: 'only owners and admins can delete channels' }, { status: 403 })
    }
  }

  // Delete the channel — cascades to messages, read receipts, channel
  // members, etc. (per the Prisma schema's onDelete: Cascade).
  // If this was the only channel in the group, the group itself becomes
  // empty — we leave it (the group row persists for potential re-use).
  await db.channel.delete({ where: { id: channelId } })

  return NextResponse.json({ ok: true })
}
