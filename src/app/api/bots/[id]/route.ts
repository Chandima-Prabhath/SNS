import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Update bot config / enable / disable / flow
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const role = session.user.role
  const { id } = await params

  const bot = await db.bot.findUnique({ where: { id } })
  if (!bot) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // Only the owner can edit their own bots. Admins/owners can also edit.
  if (bot.ownerId !== userId && role !== 'admin' && role !== 'owner') {
    return NextResponse.json({ error: 'forbidden — only the bot owner can edit' }, { status: 403 })
  }

  const body = await req.json()
  const allowed = ['name', 'description', 'avatarUrl', 'module', 'enabled', 'privacyMode', 'config', 'flow']
  const data: any = {}
  for (const k of allowed) {
    if (k in body) {
      if (k === 'config' && typeof body[k] === 'object') {
        data[k] = JSON.stringify(body[k])
      } else if (k === 'flow' && typeof body[k] === 'object') {
        data[k] = JSON.stringify(body[k])
      } else {
        data[k] = body[k]
      }
    }
  }

  // If the flow is being updated, clear all paused conversation sessions for
  // this bot — otherwise stale `pausedAt` state would cause the bot to treat
  // the next message as a reply to a node that no longer exists in the flow.
  if ('flow' in body) {
    await db.conversationSession.deleteMany({ where: { botId: id } }).catch(() => {})
  }

  const updated = await db.bot.update({ where: { id }, data })
  return NextResponse.json({ bot: updated })
}

// Delete bot — owner only
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const role = session.user.role
  const { id } = await params

  const bot = await db.bot.findUnique({ where: { id } })
  if (!bot) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (bot.ownerId !== userId && role !== 'admin' && role !== 'owner') {
    return NextResponse.json({ error: 'forbidden — only the bot owner can delete' }, { status: 403 })
  }

  await db.bot.delete({ where: { id } })
  await db.user.deleteMany({ where: { id: bot.id } }).catch(() => {})

  return NextResponse.json({ ok: true })
}
