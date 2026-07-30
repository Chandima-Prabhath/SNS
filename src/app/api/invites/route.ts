import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getOrCreateDmChannel } from '@/lib/chat-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/invites — Send an invitation to a user's DM.
 *
 * Body: {
 *   targetUserId: string,
 *   type: 'call' | 'music',
 *   targetId: string,        // callId (for calls) or roomId (for music)
 *   channelId?: string,      // for calls: the voice/video channel ID
 *   dmGroupId?: string,      // for DM calls
 *   isVideo?: boolean,       // for calls: voice vs video
 *   roomName?: string,       // for music: the room name (for display)
 * }
 *
 * Creates a DM channel between the sender and target user (if it doesn't
 * exist), then sends a system message with mediaType='invite-call' or
 * 'invite-music'. The message body is JSON with the invite metadata.
 *
 * The client renders these messages as interactive cards with Join/Decline
 * buttons (see message-list.tsx).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const senderName = (session.user as any).displayName || (session.user as any).username || 'User'

  const body = await req.json()
  const { targetUserId, type, targetId, channelId, dmGroupId, isVideo, roomName } = body

  if (!targetUserId || !type || !targetId) {
    return NextResponse.json({ error: 'targetUserId, type, targetId required' }, { status: 400 })
  }
  if (type !== 'call' && type !== 'music') {
    return NextResponse.json({ error: 'type must be "call" or "music"' }, { status: 400 })
  }

  // Don't allow inviting yourself
  if (targetUserId === userId) {
    return NextResponse.json({ error: 'cannot invite yourself' }, { status: 400 })
  }

  // Verify the target user exists
  const targetUser = await db.user.findUnique({ where: { id: targetUserId } })
  if (!targetUser) {
    return NextResponse.json({ error: 'target user not found' }, { status: 404 })
  }

  // Get or create the DM channel between sender and target
  const dmChannel = await getOrCreateDmChannel(userId, targetUserId)

  // Build the invite metadata (stored as JSON in the message body)
  const inviteData = {
    type,
    targetId,
    channelId: channelId || null,
    dmGroupId: dmGroupId || null,
    isVideo: isVideo ?? false,
    roomName: roomName || null,
    fromUserId: userId,
    fromName: senderName,
    createdAt: new Date().toISOString(),
  }

  // Create the invitation message
  const message = await db.message.create({
    data: {
      channelId: dmChannel.id,
      senderType: 'system',
      senderId: userId,
      body: JSON.stringify(inviteData),
      mediaType: type === 'call' ? 'invite-call' : 'invite-music',
    },
    include: {
      sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
    },
  })

  return NextResponse.json({ message, channelId: dmChannel.id })
}
