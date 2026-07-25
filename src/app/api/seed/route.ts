import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * Seed the database with sensible defaults:
 *   - One group "Friends" with 3 channels: general, memes, voice-hangout
 *   - The first registered user becomes the owner of that group
 *
 * Idempotent — running twice won't duplicate anything.
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  // Promote first user to owner if no owner exists yet
  const ownerCount = await db.user.count({ where: { role: 'owner' } })
  if (ownerCount === 0) {
    await db.user.update({ where: { id: userId }, data: { role: 'owner' } })
  }

  // Check for default group
  let group = await db.group.findFirst({ where: { name: 'Friends', isDm: false }, include: { channels: true } })
  if (!group) {
    group = await db.group.create({
      data: {
        name: 'Friends',
        description: 'The main hangout spot',
        ownerId: userId,
        isDm: false,
        channels: {
          create: [
            { name: 'general', type: 'text', order: 0 },
            { name: 'memes', type: 'text', order: 1 },
            { name: 'voice-hangout', type: 'voice', order: 2 },
          ],
        },
      },
      include: { channels: true },
    })
  }

  // Add current user as member of all channels (text + voice)
  for (const ch of group.channels) {
    await db.channelMember
      .upsert({
        where: { channelId_userId: { channelId: ch.id, userId } },
        create: { channelId: ch.id, userId, role: 'owner' },
        update: {},
      })
      .catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    group,
    message: 'Seed complete. You are now the owner of the "Friends" group.',
  })
}
