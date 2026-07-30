import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { dispatchBotCallback } from '@/lib/bot/framework'

// Force dynamic Node.js route — bot dispatch involves DB writes + bot logic.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/channels/:id/messages/:messageId/callback
 *
 * Handles an inline keyboard button click (Telegram-style callback).
 * Body: { callbackData: string }
 *
 * Flow:
 *   1. Auth the user + verify they're a channel member.
 *   2. Load the original message (must have a keyboard + be from a bot).
 *   3. Extract the botId from the message's senderId.
 *   4. Call dispatchBotCallback — this resumes the visual bot's paused
 *      wait_choice node, passing the callbackData as the "reply".
 *   5. Fetch any bot replies created during dispatch and return them so
 *      the client can broadcast them via socket.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id
  const { id: channelId, messageId } = await params

  // Verify channel membership
  const membership = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'not a channel member' }, { status: 403 })
  }

  const body = await req.json()
  const { callbackData } = body
  if (!callbackData || typeof callbackData !== 'string') {
    return NextResponse.json({ error: 'callbackData required' }, { status: 400 })
  }

  // Load the original message — must be a bot message with a keyboard
  const originalMessage = await db.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      senderType: true,
      senderId: true,
      keyboard: true,
      createdAt: true,
    },
  })

  if (!originalMessage) {
    return NextResponse.json({ error: 'message not found' }, { status: 404 })
  }

  if (originalMessage.senderType !== 'bot' || !originalMessage.senderId) {
    return NextResponse.json({ error: 'not a bot message' }, { status: 400 })
  }

  if (!originalMessage.keyboard) {
    return NextResponse.json({ error: 'message has no keyboard' }, { status: 400 })
  }

  const botId = originalMessage.senderId
  const senderName = (session.user as any).username || (session.user as any).displayName || 'User'

  // Dispatch the callback to the bot — this resumes the paused flow
  await dispatchBotCallback({
    botId,
    channelId,
    senderId: userId,
    senderName,
    messageId,
    callbackData,
    replyToId: messageId,
  })

  // Fetch any bot replies created during dispatch (same pattern as the
  // messages POST route)
  const botReplies = await db.message.findMany({
    where: {
      channelId,
      senderType: 'bot',
      createdAt: { gte: originalMessage.createdAt },
      id: { not: messageId }, // exclude the original message itself
    },
    include: {
      sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      replyTo: {
        select: { id: true, body: true, senderType: true, sender: { select: { username: true, displayName: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Get recipient IDs for socket broadcast
  const memberIds = await db.channelMember.findMany({
    where: { channelId },
    select: { userId: true },
  })
  const recipientIds = memberIds.map((m) => m.userId).filter((id) => id !== userId)

  return NextResponse.json({
    botReplies,
    recipientIds,
  })
}
