import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { dispatchBotCallback, getAndClearEditedMessages } from '@/lib/bot/framework'

// Force dynamic Node.js route — bot dispatch involves DB writes + bot logic.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/channels/:id/messages/:messageId/callback
 *
 * Handles an inline keyboard button click (Telegram-style callback).
 * Body: { callbackData: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const userId = (session.user as any).id
    const { id: channelId, messageId } = await params

    console.log(`[callback] channelId=${channelId} messageId=${messageId} userId=${userId}`)

    // Verify channel membership
    const membership = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    })
    if (!membership) {
      console.log(`[callback] not a channel member`)
      return NextResponse.json({ error: 'not a channel member' }, { status: 403 })
    }

    const body = await req.json()
    const { callbackData } = body
    if (!callbackData || typeof callbackData !== 'string') {
      console.log(`[callback] missing callbackData`)
      return NextResponse.json({ error: 'callbackData required' }, { status: 400 })
    }

    console.log(`[callback] callbackData=${callbackData}`)

    // Load the original message — must be a bot message with a keyboard
    const originalMessage = await db.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        body: true,
        senderType: true,
        senderId: true,
        keyboard: true,
        createdAt: true,
      },
    })

    if (!originalMessage) {
      console.log(`[callback] original message not found`)
      return NextResponse.json({ error: 'message not found' }, { status: 404 })
    }

    console.log(`[callback] originalMessage: senderType=${originalMessage.senderType} senderId=${originalMessage.senderId} hasKeyboard=${!!originalMessage.keyboard}`)

    if (originalMessage.senderType !== 'bot' || !originalMessage.senderId) {
      console.log(`[callback] not a bot message`)
      return NextResponse.json({ error: 'not a bot message' }, { status: 400 })
    }

    if (!originalMessage.keyboard) {
      console.log(`[callback] message has no keyboard`)
      return NextResponse.json({ error: 'message has no keyboard' }, { status: 400 })
    }

    const botId = originalMessage.senderId
    const senderName = (session.user as any).username || (session.user as any).displayName || 'User'

    // Record timestamp BEFORE dispatch — we'll query bot replies created
    // after this moment to avoid matching stale messages
    const dispatchStart = new Date()

    console.log(`[callback] dispatching to bot ${botId}...`)

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

    console.log(`[callback] dispatch complete, fetching bot replies since ${dispatchStart.toISOString()}`)

    // Fetch bot replies created during dispatch (using the dispatch start
    // timestamp to avoid matching stale messages)
    const botReplies = await db.message.findMany({
      where: {
        channelId,
        senderType: 'bot',
        createdAt: { gte: dispatchStart },
      },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        replyTo: {
          select: { id: true, body: true, senderType: true, sender: { select: { username: true, displayName: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`[callback] found ${botReplies.length} bot replies`)

    // Check for messages that were EDITED during dispatch (Telegram-style
    // edit-in-place). The framework tracks edited message IDs via
    // trackEditedMessage() — we fetch the full message data for each.
    const editedMessages: any[] = []
    try {
      const editedIds = getAndClearEditedMessages()
      if (editedIds.length > 0) {
        const edited = await db.message.findMany({
          where: { id: { in: editedIds } },
          include: {
            sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
            replyTo: {
              select: { id: true, body: true, senderType: true, sender: { select: { username: true, displayName: true } } },
            },
          },
        })
        // Only include messages not already in botReplies (avoid duplicates)
        const replyIds = new Set(botReplies.map((r: any) => r.id))
        for (const msg of edited) {
          if (!replyIds.has(msg.id)) {
            editedMessages.push(msg)
          }
        }
      }
    } catch (e) {
      console.error('[callback] error fetching edited messages:', e)
    }

    // Get recipient IDs for socket broadcast
    const memberIds = await db.channelMember.findMany({
      where: { channelId },
      select: { userId: true },
    })
    const recipientIds = memberIds.map((m) => m.userId).filter((id) => id !== userId)

    return NextResponse.json({
      botReplies,
      editedMessages,
      recipientIds,
    })
  } catch (e: any) {
    console.error('[callback] error:', e)
    return NextResponse.json(
      { error: e?.message || 'callback failed' },
      { status: 500 }
    )
  }
}
