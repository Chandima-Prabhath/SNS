import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Start a new voice call in a channel
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const body = await req.json()
  const { channelId, dmGroupId } = body

  if (!channelId && !dmGroupId) {
    return NextResponse.json({ error: 'channelId or dmGroupId required' }, { status: 400 })
  }

  // End any other active call in the same channel/dm (one at a time)
  if (channelId) {
    await db.voiceCall.updateMany({
      where: { channelId, status: 'active' },
      data: { status: 'ended', endedAt: new Date() },
    })
  }

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
  })

  return NextResponse.json({ call })
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
      participants: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } },
      starter: { select: { id: true, username: true, displayName: true } },
    },
  })
  return NextResponse.json({ calls })
}
