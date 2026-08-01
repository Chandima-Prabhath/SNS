/**
 * GET /api/search?q=<query>
 *
 * Global search across users, channels, and bots.
 * Returns up to 5 results per category, unified into a single response.
 * Used by the Cmd+K command palette.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ users: [], channels: [], bots: [] })
  }

  // Search users (excluding self) — limit 5
  const users = await db.user.findMany({
    where: {
      id: { not: userId },
      OR: [
        { username: { contains: q } },
        { displayName: { contains: q } },
      ],
    },
    select: { id: true, username: true, displayName: true, avatarUrl: true, status: true },
    take: 5,
    orderBy: [{ status: 'desc' }, { username: 'asc' }],
  })

  // Search channels the user is a member of — limit 5
  const memberships = await db.channelMember.findMany({
    where: { userId },
    select: { channelId: true },
  })
  const memberChannelIds = memberships.map((m) => m.channelId)

  let channels: any[] = []
  if (memberChannelIds.length > 0) {
    const groups = await db.group.findMany({
      where: {
        channels: { some: { id: { in: memberChannelIds } } },
        OR: [
          { name: { contains: q } },
          { channels: { some: { name: { contains: q } } } },
        ],
      },
      include: {
        channels: {
          where: { id: { in: memberChannelIds } },
          select: { id: true, name: true, type: true },
          take: 1,
        },
      },
      take: 5,
    })
    channels = groups.map((g) => ({
      groupId: g.id,
      groupName: g.name,
      iconUrl: g.iconUrl,
      isDm: g.isDm,
      channelId: g.channels[0]?.id,
      channelName: g.channels[0]?.name,
    }))
  }

  // Search user's bots — limit 5
  const bots = await db.bot.findMany({
    where: {
      ownerId: userId,
      OR: [
        { name: { contains: q } },
        { username: { contains: q } },
      ],
    },
    select: { id: true, name: true, username: true, module: true, enabled: true },
    take: 5,
  })

  return NextResponse.json({ users, channels, bots })
}
