import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * POST /api/calls — start OR join a voice call.
 *
 * If there's an active call in the channel/DM, JOIN it (add participant).
 * If not, CREATE a new one.
 *
 * This was the bug: previously every "Join" click created a new call,
 * so two users clicking Join on the same channel ended up in two separate
 * calls and couldn't see each other.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const body = await req.json()
  const { channelId, dmGroupId } = body

  if (!channelId && !dmGroupId) {
    return NextResponse.json({ error: 'channelId or dmGroupId required' }, { status: 400 })
  }

  // Authorization: caller must be a member of the channel or DM group
  if (channelId) {
    const membership = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    })
    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  } else if (dmGroupId) {
    const dmLink = await db.dmLink.findFirst({
      where: { id: dmGroupId, OR: [{ userAId: userId }, { userBId: userId }] },
    })
    if (!dmLink) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  // Look for an existing active call in this channel/DM
  const where = channelId
    ? { channelId, status: 'active' as const }
    : { dmGroupId, status: 'active' as const }

  const existingCall = await db.voiceCall.findFirst({
    where,
    include: {
      participants: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      },
    },
  })

  if (existingCall) {
    // Join the existing call — add this user as a participant (or rejoin if they left)
    await db.callParticipant.upsert({
      where: { callId_userId: { callId: existingCall.id, userId } },
      create: { callId: existingCall.id, userId },
      update: { leftAt: null }, // re-join if they previously left
    })

    // Refresh with the upserted participant
    const refreshed = await db.voiceCall.findUnique({
      where: { id: existingCall.id },
      include: {
        participants: {
          include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        },
      },
    })

    return NextResponse.json({ call: refreshed, joined: true })
  }

  // No active call — create a new one
  const call = await db.voiceCall.create({
    data: {
      channelId: channelId || null,
      dmGroupId: dmGroupId || null,
      startedBy: userId,
      status: 'active',
      participants: {
        create: { userId },
      },
    },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      },
    },
  })

  return NextResponse.json({ call, joined: false })
}

// List active calls
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')

  const calls = await db.voiceCall.findMany({
    where: {
      status: 'active',
      ...(channelId ? { channelId } : {}),
    },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      },
      starter: { select: { id: true, username: true, displayName: true } },
    },
  })
  return NextResponse.json({ calls })
}
