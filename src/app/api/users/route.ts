import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/users
 *
 * Lists users for DM creation, mentions, invites, etc.
 *
 * Query params:
 *   - search: filter by username/displayName (case-insensitive contains)
 *   - limit: max results (default 20, max 50)
 *
 * When no search query is provided, returns only the first 20 users ordered
 * by online status (online first) then username. This prevents loading ALL
 * users when the app scales beyond 100 users.
 *
 * Bot status is overlaid: enabled bots show as 'online', disabled as 'offline'.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const currentUserId = (session.user as any).id

  const url = new URL(req.url)
  const search = url.searchParams.get('search')?.trim()
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50)

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
      status: true,
      customStatus: true,
    },
    orderBy: [
      { status: 'desc' }, // online users first
      { username: 'asc' },
    ],
    take: limit,
  })

  // Batch bot lookups — single query instead of per-user
  const botIds = users.map((u) => u.id)
  const bots = botIds.length > 0
    ? await db.bot.findMany({ where: { id: { in: botIds } }, select: { id: true, enabled: true, name: true } })
    : []
  const botMap = new Map(bots.map((b) => [b.id, b]))

  const usersWithBotStatus = users.map((u) => {
    const botRecord = botMap.get(u.id)
    if (botRecord) {
      return {
        ...u,
        status: botRecord.enabled ? 'online' : 'offline',
        isBot: true,
      }
    }
    return { ...u, isBot: false }
  })

  return NextResponse.json({ users: usersWithBotStatus })
}
