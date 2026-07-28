import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/music/rooms — List all active music rooms the user can see.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  // Get rooms where I'm the host or a member
  const [hostedRooms, memberRooms] = await Promise.all([
    db.musicRoom.findMany({
      where: { hostId: userId },
      include: {
        host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        members: {
          include: {
            user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    db.musicRoomMember.findMany({
      where: { userId },
      include: {
        room: {
          include: {
            host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
            members: {
              include: {
                user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    }),
  ])

  const rooms = [
    ...hostedRooms,
    ...memberRooms.map((m) => m.room),
  ]

  return NextResponse.json({ rooms })
}

/**
 * POST /api/music/rooms — Create a new music room.
 * Body: { name: string }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
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
