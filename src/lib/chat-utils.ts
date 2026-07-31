import { db } from '@/lib/db'

/**
 * Returns the channels a user is a member of.
 */
export async function getUserChannels(userId: string) {
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
  return memberships.map((m) => m.channel)
}

/**
 * Ensure a user is a member of a channel.
 */
export async function ensureChannelMember(channelId: string, userId: string, role: string = 'member') {
  const existing = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (existing) return existing
  return db.channelMember.create({
    data: { channelId, userId, role },
  })
}

/**
 * Determine if a user can post in a channel.
 */
export async function canPostInChannel(channelId: string, userId: string): Promise<boolean> {
  const membership = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (!membership) return false
  if (membership.role === 'muted') return false
  return true
}

/**
 * Create a DM group between two users (1:1). Returns the existing or new DM channel.
 *
 * RACE-SAFE: Uses a DmLink table with a unique constraint on (userAId, userBId)
 * to guarantee only ONE DM channel can exist between any two users, even under
 * concurrent requests. The user IDs are canonically ordered (smaller first) so
 * that (A→B) and (B→A) map to the same row.
 *
 * Flow:
 *   1. Check if a DmLink already exists for this pair → return its channel
 *   2. Otherwise, create the group + channel + members + DmLink in a transaction
 *   3. If another concurrent request won the race (P2002 unique violation),
 *      fall back to fetching the existing channel
 *
 * The P2002 fallback is what makes this safe under concurrency — even if two
 * requests pass step 1 simultaneously, only one wins at step 2; the other
 * gets a P2002 and fetches the winner's channel.
 */
export async function getOrCreateDmChannel(userIdA: string, userIdB: string) {
  // Canonical ordering: smaller userId first
  const [userAId, userBId] = [userIdA, userIdB].sort()

  // 1. Fast path — check for existing DM link
  const existing = await db.dmLink.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    include: { group: { include: { channels: true } } },
  })
  if (existing) {
    return existing.group.channels[0]
  }

  // 2. Create new DM group + channel + members + DmLink in a transaction
  const userA = await db.user.findUnique({ where: { id: userIdA } })
  const userB = await db.user.findUnique({ where: { id: userIdB } })
  if (!userA || !userB) throw new Error('user not found')

  try {
    const result = await db.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: {
          name: `${userA.username}-${userB.username}`,
          isDm: true,
          ownerId: userIdA,
          channels: {
            create: { name: 'dm', type: 'text' },
          },
          dmLink: {
            create: { userAId, userBId },
          },
        },
        include: { channels: true },
      })

      const channel = group.channels[0]
      await tx.channelMember.createMany({
        data: [
          { channelId: channel.id, userId: userIdA, role: 'member' },
          { channelId: channel.id, userId: userIdB, role: 'member' },
        ],
      })

      return channel
    })
    return result
  } catch (e: any) {
    // 3. P2002 = unique constraint violation — another concurrent request
    // already created this DM. Fetch and return it.
    if (e?.code === 'P2002') {
      const link = await db.dmLink.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
        include: { group: { include: { channels: true } } },
      })
      if (link) {
        return link.group.channels[0]
      }
    }
    throw e
  }
}
