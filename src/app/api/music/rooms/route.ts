import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/music/rooms — List ALL music rooms (public to all users).
 * Anyone can see and join any room — it's a shared listening experience.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Return ALL rooms — anyone can see and join them
  const rooms = await db.musicRoom.findMany({
    include: {
      host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({ rooms })
}

/**
 * POST /api/music/rooms — Create a new music room.
 * Body: { name: string }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { name } = await req.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }

  const room = await db.musicRoom.create({
    data: {
      name: name.trim(),
      hostId: userId,
      members: {
        create: { userId }, // host is automatically a member
      },
    },
    include: {
      host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  })

  return NextResponse.json({ room })
}
