import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// List all users (for DM creation, mentions, invites, etc.)
// Optional ?search=username filters by username/displayName
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const currentUserId = (session.user as any).id

  const url = new URL(req.url)
  const search = url.searchParams.get('search')?.trim()

  const users = await db.user.findMany({
    where: {
      id: { not: currentUserId },
      ...(search ? {
        OR: [
          { username: { contains: search } },
          { displayName: { contains: search } },
        ],
      } : {}),
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      status: true,
      customStatus: true,
      lastSeenAt: true,
      lastSeenVisible: true,
    },
    orderBy: { username: 'asc' },
  })

  // For each user that is actually a bot, set their status based on the
  // bot's enabled flag — enabled bots show as 'online', disabled as 'offline'
  const botIds = users.map((u) => u.id)
  const bots = await db.bot.findMany({
    where: { id: { in: botIds } },
    select: { id: true, enabled: true },
  })
  const botMap = new Map(bots.map((b) => [b.id, b.enabled]))

  const usersWithBotStatus = users.map((u) => {
    if (botMap.has(u.id)) {
      return { ...u, status: botMap.get(u.id) ? 'online' : 'offline' }
    }
    return u
  })

  return NextResponse.json({ users: usersWithBotStatus })
}
