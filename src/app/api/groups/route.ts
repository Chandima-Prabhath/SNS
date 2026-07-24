import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getOrCreateDmChannel } from '@/lib/chat-utils'

// Create a new group + channels
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const body = await req.json()
  const { name, description, channels = ['general'] } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const group = await db.group.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      ownerId: userId,
      isDm: false,
      channels: {
        create: channels.map((name: string, i: number) => ({
          name,
          type: 'text',
          order: i,
        })),
      },
    },
    include: { channels: true },
  })

  // Add owner as a member of each channel
  await db.channelMember.createMany({
    data: group.channels.map((ch) => ({
      channelId: ch.id,
      userId,
      role: 'owner',
    })),
  })

  return NextResponse.json({ group })
}

// Get or create a DM channel between current user and target user
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { targetUserId } = await req.json()
  if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 })

  const channel = await getOrCreateDmChannel(userId, targetUserId)
  return NextResponse.json({ channel })
}

// Join a group via invite code
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { inviteCode } = await req.json()
  if (!inviteCode) return NextResponse.json({ error: 'inviteCode required' }, { status: 400 })

  const group = await db.group.findUnique({
    where: { inviteCode },
    include: { channels: true },
  })
  if (!group) return NextResponse.json({ error: 'invalid invite code' }, { status: 404 })

  for (const ch of group.channels) {
    if (ch.type === 'text') {
      await db.channelMember
        .create({ data: { channelId: ch.id, userId, role: 'member' } })
        .catch(() => {})
    }
  }
  return NextResponse.json({ group })
}
