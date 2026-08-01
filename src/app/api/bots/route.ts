import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { listBotModules } from '@/lib/bot'

// List current user's bots + available modules
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const bots = await db.bot.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
  })

  const modules = listBotModules().map((m) => ({
    name: m.name,
    description: m.description,
    commands: m.commands.map((c) => ({ name: c.name, description: c.description })),
  }))

  return NextResponse.json({ bots, modules })
}

// Create a new bot
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const body = await req.json()
  const { name, username, description, module, avatarUrl } = body

  if (!name?.trim() || !username?.trim()) {
    return NextResponse.json({ error: 'name and username required' }, { status: 400 })
  }

  const lowerUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (lowerUsername.length < 3) {
    return NextResponse.json({ error: 'username must be 3+ chars (a-z, 0-9, _)' }, { status: 400 })
  }

  const existing = await db.bot.findUnique({ where: { username: lowerUsername } })
  if (existing) return NextResponse.json({ error: 'bot username taken' }, { status: 409 })

  // Use a transaction — if user creation fails, the bot row is rolled back
  // (prevents orphan Bot rows pointing at non-existent Users)
  const bot = await db.$transaction(async (tx) => {
    const bot = await tx.bot.create({
      data: {
        ownerId: userId,
        name: name.trim(),
        username: lowerUsername,
        description: description?.trim() || null,
        module: module || 'echo',
        avatarUrl: avatarUrl || null,
      },
    })

    // Create a User row for the bot too (so it can be a channel member)
    await tx.user.create({
      data: {
        id: bot.id,
        email: `bot+${lowerUsername}@sns.local`,
        username: `bot_${lowerUsername}`,
        displayName: name.trim(),
        passwordHash: 'bot-no-login',
        role: 'member',
      },
    })

    return bot
  })

  return NextResponse.json({ bot })
}
