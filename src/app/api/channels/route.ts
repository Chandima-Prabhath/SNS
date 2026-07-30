import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/channels
 *
 * Returns all channels the current user is a member of, grouped by their group.
 * For DM channels (isDm=true), includes a `partner` field with the other user's
 * info so the chat list can display their name/avatar instead of "dm".
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const memberships = await db.channelMember.findMany({
    where: { userId },
    include: {
      channel: {
        include: {
          group: true,
        },
      },
    },
    orderBy: { channel: { order: 'asc' } },
  })

  const channels = memberships.map((m) => m.channel)

  // Group by group
  const groupsMap: Record<string, any> = {}
  for (const ch of channels) {
    if (!groupsMap[ch.groupId]) {
      groupsMap[ch.groupId] = {
        id: ch.group.id,
        name: ch.group.name,
        iconUrl: ch.group.iconUrl,
        isDm: ch.group.isDm,
        inviteCode: ch.group.inviteCode,
        ownerId: ch.group.ownerId,
        channels: [],
      }
    }
    groupsMap[ch.groupId].channels.push(ch)
  }

  // For DM groups, look up the partner user (the other member)
  const groups = Object.values(groupsMap)
  for (const g of groups) {
    if (g.isDm) {
      // Find the other member across all channels in this DM group
      const dmChannelIds = g.channels.map((c: any) => c.id)
      const otherMembers = await db.channelMember.findMany({
        where: {
          channelId: { in: dmChannelIds },
          userId: { not: userId },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              bio: true,
              status: true,
              customStatus: true,
            },
          },
        },
        take: 1,
      })
      g.partner = otherMembers[0]?.user || null

      // If the partner is a bot (bot.id == user.id), set their status based
      // on the bot's enabled flag — enabled bots show as 'online', disabled as 'offline'
      if (g.partner) {
        const botRecord = await db.bot.findUnique({
          where: { id: g.partner.id },
          select: { enabled: true },
        }).catch(() => null)
        if (botRecord) {
          g.partner.status = botRecord.enabled ? 'online' : 'offline'
        }
      }

      // Override each channel's name to be the partner's display name
      // so the chat list shows "Jane Doe" instead of "dm"
      if (g.partner) {
        for (const ch of g.channels) {
          ch.name = g.partner.displayName
          ch.partner = g.partner
        }
      }
    }
  }

  return NextResponse.json({ groups })
}
