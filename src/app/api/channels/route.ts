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

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch the latest message for each text channel.
  //
  // Voice/video channels don't have a message preview, so we skip them. For
  // each text channel we run a `findFirst` (take:1) ordered by createdAt desc.
  // The Message table has `@@index([channelId, createdAt])` so each query is
  // an indexed lookup — fast even for channels with long histories.
  //
  // We run the per-channel queries in parallel via `Promise.all` so the total
  // latency is one round-trip rather than N. This avoids loading every
  // message of every channel into memory just to find the latest of each
  // (which a single `findMany` with dedupe would do).
  // ─────────────────────────────────────────────────────────────────────────
  const textChannels = channels.filter((c) => c.type === 'text')
  const latestMessages = await Promise.all(
    textChannels.map((ch) =>
      db.message.findFirst({
        where: { channelId: ch.id, deletedAt: null },
        include: {
          sender: {
            select: { id: true, username: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    )
  )

  // Map channelId → latest message
  const latestByChannel = new Map<
    string,
    { body: string; mediaUrl: string | null; mediaType: string | null; senderType: string; senderId: string | null; sender: { displayName: string | null; username: string | null } | null; createdAt: Date }
  >()
  textChannels.forEach((ch, i) => {
    const m = latestMessages[i]
    if (m) latestByChannel.set(ch.id, m)
  })

  // Attach `lastMessage` + `lastMessageAt` to each channel
  for (const ch of channels) {
    const latest = latestByChannel.get(ch.id)
    if (latest) {
      // Bots have a corresponding User row (created at bot-creation time in
      // /api/bots), so `latest.sender` is populated for both user and bot
      // senders. We fall back to "Bot"/"Unknown" only if the User record
      // was deleted (onDelete: SetNull on Message.sender).
      const senderName =
        latest.sender?.displayName ||
        latest.sender?.username ||
        (latest.senderType === 'bot' ? 'Bot' : 'Unknown')
      // For invite messages, show a friendly preview instead of raw JSON
      let previewBody = latest.body
      if (latest.mediaType === 'invite-call' || latest.mediaType === 'invite-music') {
        try {
          const invite = JSON.parse(latest.body)
          previewBody = invite.type === 'call'
            ? `📞 Call invitation`
            : `🎵 Music room invitation`
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
      // Fall back to channel creation time so empty channels sort predictably
      ;(ch as any).lastMessageAt = ch.createdAt
    }
  }

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
          select: { enabled: true, name: true },
        }).catch(() => null)
        if (botRecord) {
          g.partner.status = botRecord.enabled ? 'online' : 'offline'
          // Use the bot's name as displayName if the user record didn't have one
          if (!g.partner.displayName) g.partner.displayName = botRecord.name
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
