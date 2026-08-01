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
 *
 * Each text channel also includes a `lastMessage` object (body, mediaType,
 * senderName, senderType, createdAt) and a `lastMessageAt` timestamp so the
 * chat list can sort by most recent activity and show a message preview.
 *
 * OPTIMIZED: Uses a single raw SQL query to fetch the latest message per
 * channel (instead of N parallel findFirst queries). DM partner lookups
 * are batched into a single findMany.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  // 1. Fetch all memberships with channel + group info (single query)
  const memberships = await db.channelMember.findMany({
    where: { userId },
    include: { channel: { include: { group: true } } },
    orderBy: { channel: { order: 'asc' } },
  })

  const channels = memberships.map((m) => m.channel)
  const textChannelIds = channels.filter((c) => c.type === 'text').map((c) => c.id)

  // 2. Fetch latest message per text channel in ONE query (raw SQL)
  //    Uses a correlated subquery — much faster than N findFirst queries.
  let latestByChannel = new Map<string, any>()
  if (textChannelIds.length > 0) {
    const placeholders = textChannelIds.map(() => '?').join(',')
    const rows = await db.$queryRaw`
      SELECT m.*,
             u."displayName" as "senderDisplayName",
             u."username" as "senderUsername"
      FROM "Message" m
      LEFT JOIN "User" u ON u.id = m."senderId"
      WHERE m."channelId" IN (${textChannelIds.map((id) => id)}) 
        AND m."deletedAt" IS NULL
        AND m."createdAt" = (
          SELECT MAX(m2."createdAt")
          FROM "Message" m2
          WHERE m2."channelId" = m."channelId"
            AND m2."deletedAt" IS NULL
        )
    ` as any[]

    for (const row of rows) {
      latestByChannel.set(row.channelId, row)
    }
  }

  // Attach lastMessage to each channel
  for (const ch of channels) {
    const latest = latestByChannel.get(ch.id)
    if (latest) {
      const senderName =
        latest.senderDisplayName ||
        latest.senderUsername ||
        (latest.senderType === 'bot' ? 'Bot' : 'Unknown')
      let previewBody = latest.body
      if (latest.mediaType === 'invite-call' || latest.mediaType === 'invite-music') {
        try {
          const invite = JSON.parse(latest.body)
          previewBody = invite.type === 'call' ? '📞 Call invitation' : '🎵 Music room invitation'
        } catch {
          previewBody = 'Invitation'
        }
      }
      ;(ch as any).lastMessage = {
        body: previewBody,
        mediaUrl: latest.mediaUrl,
        mediaType: latest.mediaType,
        senderName,
        senderType: latest.senderType,
        senderId: latest.senderId,
        createdAt: latest.createdAt,
      }
      ;(ch as any).lastMessageAt = latest.createdAt
    } else {
      ;(ch as any).lastMessage = null
      ;(ch as any).lastMessageAt = ch.createdAt
    }
  }

  // 3. Group by group
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

  // 4. Batch DM partner lookups — single query for ALL DM channels
  const groups = Object.values(groupsMap)
  const dmGroups = groups.filter((g) => g.isDm)
  if (dmGroups.length > 0) {
    const allDmChannelIds = dmGroups.flatMap((g) => g.channels.map((c: any) => c.id))
    const allPartners = await db.channelMember.findMany({
      where: {
        channelId: { in: allDmChannelIds },
        userId: { not: userId },
      },
      include: {
        user: {
          select: {
            id: true, username: true, displayName: true, avatarUrl: true,
            bio: true, status: true, customStatus: true,
          },
        },
      },
    })

    // Map channelId → partner user
    const partnerByChannel = new Map<string, any>()
    for (const pm of allPartners) {
      partnerByChannel.set(pm.channelId, pm.user)
    }

    // Batch bot lookups for DM partners
    const partnerIds = [...new Set(allPartners.map((p) => p.userId))]
    const bots = partnerIds.length > 0
      ? await db.bot.findMany({ where: { id: { in: partnerIds } }, select: { id: true, enabled: true, name: true } })
      : []
    const botMap = new Map(bots.map((b) => [b.id, b]))

    for (const g of dmGroups) {
      const firstChannel = g.channels[0]
      const partner = partnerByChannel.get(firstChannel.id)
      if (!partner) continue

      const botRecord = botMap.get(partner.id)
      if (botRecord) {
        partner.status = botRecord.enabled ? 'online' : 'offline'
        if (!partner.displayName) partner.displayName = botRecord.name
      }

      g.partner = partner
      for (const ch of g.channels) {
        ch.name = partner.displayName
        ch.partner = partner
      }
    }
  }

  return NextResponse.json({ groups })
}
