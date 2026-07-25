import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Update bot config / enable / disable
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const bot = await db.bot.findUnique({ where: { id } })
  if (!bot) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (bot.ownerId !== userId && (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const allowed = ['name', 'description', 'avatarUrl', 'module', 'enabled', 'privacyMode', 'config']
  const data: any = {}
  for (const k of allowed) {
    if (k in body) {
      if (k === 'config' && typeof body[k] === 'object') {
        data[k] = JSON.stringify(body[k])
      } else {
        data[k] = body[k]
      }
    }
  }

  const updated = await db.bot.update({ where: { id }, data })
  return NextResponse.json({ bot: updated })
}

// Delete bot
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const bot = await db.bot.findUnique({ where: { id } })
  if (!bot) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (bot.ownerId !== userId && (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await db.bot.delete({ where: { id } })
  await db.user.deleteMany({ where: { id: bot.id } }).catch(() => {})

  return NextResponse.json({ ok: true })
}
