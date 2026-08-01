import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/unread
 *
 * Returns unread message counts per channel for the current user.
 * A message is "unread" if it was created after the user's lastReadMessageId
 * on that channel's membership, AND it wasn't sent by the user themselves.
 *
 * OPTIMIZED: Uses a single raw SQL query with a LEFT JOIN to compute
 * unread counts for ALL channels in one round-trip. Previously this did
 * 2 queries per membership (findUnique + count) — 40 round-trips for 20 channels.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  // Single query: for each channel membership, count messages after the
  // lastReadMessageId's createdAt timestamp (or all messages if no lastRead).
  // Uses $queryRawUnsafe — SQLite doesn't support Prisma's tagged template
  // array params. Also SQLite uses CAST() instead of ::int for type casting.
  const rows = await db.$queryRawUnsafe(`
    SELECT
      cm."channelId",
      COUNT(m.id) as "unreadCount"
    FROM "ChannelMember" cm
    LEFT JOIN "Message" m ON
      m."channelId" = cm."channelId"
      AND m."senderId" != ?
      AND m."senderType" = 'user'
      AND m."deletedAt" IS NULL
      AND m."createdAt" > COALESCE(
        (SELECT m2."createdAt" FROM "Message" m2 WHERE m2.id = cm."lastReadMessageId"),
        '1970-01-01'
      )
    WHERE cm."userId" = ?
    GROUP BY cm."channelId"
    HAVING COUNT(m.id) > 0
  `, userId, userId) as { channelId: string; unreadCount: number }[]

  const unread: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    const count = Number(row.unreadCount)
    unread[row.channelId] = count
    total += count
  }

  return NextResponse.json({ unread, total })
}
