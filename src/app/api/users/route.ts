import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// List all users (for DM creation, mentions, etc.)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const currentUserId = (session.user as any).id

  const users = await db.user.findMany({
    where: { id: { not: currentUserId } },
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

  return NextResponse.json({ users })
}
