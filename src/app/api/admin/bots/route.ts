import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { listBotModules } from '@/lib/bot'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if ((session.user as any).role !== 'admin' && (session.user as any).role !== 'owner') return null
  return session
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const bots = await db.bot.findMany({
    include: {
      owner: { select: { id: true, username: true, displayName: true } },
      _count: { select: { sessions: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const modules = listBotModules().map((m) => ({
    name: m.name,
    description: m.description,
    commands: m.commands.map((c) => ({ name: c.name, description: c.description })),
  }))

  return NextResponse.json({ bots, modules })
}

// Add a bot to a channel (admin operation)
export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { botId, channelId } = await req.json()
  if (!botId || !channelId) return NextResponse.json({ error: 'botId and channelId required' }, { status: 400 })

  const membership = await db.channelMember.upsert({
    where: { channelId_userId: { channelId, userId: botId } },
    create: { channelId, userId: botId, role: 'member' },
    update: {},
  })

  return NextResponse.json({ membership })
}
