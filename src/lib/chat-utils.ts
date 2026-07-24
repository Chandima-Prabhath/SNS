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
 */
export async function getOrCreateDmChannel(userIdA: string, userIdB: string) {
  // Find groups where both users are members and isDm=true
  const aGroups = await db.channelMember.findMany({
    where: { userId: userIdA },
    include: { channel: { include: { group: true } } },
  })
  for (const m of aGroups) {
    if (!m.channel.group.isDm) continue
    const other = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId: m.channelId, userId: userIdB } },
    })
    if (other) return m.channel
  }

  // Create new DM group + single text channel
  const userA = await db.user.findUnique({ where: { id: userIdA } })
  const userB = await db.user.findUnique({ where: { id: userIdB } })
  if (!userA || !userB) throw new Error('user not found')

  const group = await db.group.create({
    data: {
      name: `${userA.username}-${userB.username}`,
      isDm: true,
      ownerId: userIdA,
      channels: {
        create: {
          name: 'dm',
          type: 'text',
        },
      },
    },
    include: { channels: true },
  })

  const channel = group.channels[0]
  await db.channelMember.createMany({
    data: [
      { channelId: channel.id, userId: userIdA, role: 'member' },
      { channelId: channel.id, userId: userIdB, role: 'member' },
    ],
  })

  return channel
}
