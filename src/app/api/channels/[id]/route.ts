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
 * Delete a channel. Owner or admin only.
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
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json({ error: 'only owners and admins can delete channels' }, { status: 403 })
  }

  await db.channel.delete({ where: { id: channelId } })
  return NextResponse.json({ ok: true })
}
