import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getOrCreateDmChannel } from '@/lib/chat-utils'
import { z } from 'zod'

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  channels: z.array(z.string().min(1).max(50)).max(20).default(['general']),
})

// Create a new group + channels
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const body = await req.json().catch(() => ({}))
  const parsed = createGroupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input', details: parsed.error.issues }, { status: 400 })
  }
  const { name, description, channels } = parsed.data

  const group = await db.group.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      ownerId: userId,
      isDm: false,
      channels: {
        create: channels.map((chName: string, i: number) => ({
          name: chName,
          type: 'text',
          order: i,
        })),
      },
      // Owner is automatically a GroupMember with role 'owner'
      members: {
        create: { userId, role: 'owner' },
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
  const userId = session.user.id
  const { targetUserId } = await req.json()
  if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 })

  const channel = await getOrCreateDmChannel(userId, targetUserId)
  return NextResponse.json({ channel })
}

// Join a group via invite code
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { inviteCode } = await req.json()
  if (!inviteCode) return NextResponse.json({ error: 'inviteCode required' }, { status: 400 })

  const group = await db.group.findUnique({
    where: { inviteCode },
    include: { channels: true },
  })
  if (!group) return NextResponse.json({ error: 'invalid invite code' }, { status: 404 })

  // Add user as GroupMember + ChannelMember for all channels in one transaction.
  // Prevents partial joins (group member but not channel member) if one fails.
  await db.$transaction(async (tx) => {
    await tx.groupMember
      .create({ data: { groupId: group.id, userId, role: 'member' } })
      .catch(() => {}) // already a member — ignore

    // Batch-create all channel memberships at once instead of sequential
    await tx.channelMember.createMany({
      data: group.channels.map((ch) => ({ channelId: ch.id, userId, role: 'member' })),
    }).catch(() => {}) // some might already exist — ignore
  })

  return NextResponse.json({ group })
}
