import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { canPostInChannel } from '@/lib/chat-utils'

// GET messages in a channel (paginated, oldest-first)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id: channelId } = await params
  const url = new URL(req.url)
  const before = url.searchParams.get('before') // message id for cursor
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)

  const messages = await db.message.findMany({
    where: {
      channelId,
      ...(before ? { id: { lt: before } } : {}),
    },
    include: {
      sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      replyTo: {
        select: {
          id: true,
          body: true,
          senderType: true,
          sender: { select: { username: true, displayName: true } },
        },
      },
      readReceipts: { select: { userId: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Reverse to oldest-first
  return NextResponse.json({ messages: messages.reverse() })
}

// POST a new message in a channel
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: channelId } = await params

  const allowed = await canPostInChannel(channelId, userId)
  if (!allowed) return NextResponse.json({ error: 'cannot post here' }, { status: 403 })

  const body = await req.json()
  const text = (body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'empty message' }, { status: 400 })

  const replyToId = body.replyToId || null
  const mediaUrl = body.mediaUrl || null
  const mediaType = body.mediaType || null

  const message = await db.message.create({
    data: {
      channelId,
      senderType: 'user',
      senderId: userId,
      body: text.slice(0, 5000),
      replyToId,
      mediaUrl,
      mediaType,
    },
    include: {
      sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      replyTo: {
        select: { id: true, body: true, senderType: true, sender: { select: { username: true, displayName: true } } },
      },
    },
  })

  // Bot dispatch — check if message is a command or mentions a bot
  try {
    const { dispatchBotUpdate } = await import('@/lib/bot')
    const commandMatch = text.match(/^\/(\w+)(@\w+)?/)
    if (commandMatch) {
      const targetBotUsername = commandMatch[2]?.replace('@', '')
      // Find bots that are members of this channel
      const botMembers = await db.channelMember.findMany({
        where: { channel: { id: channelId } },
        include: {},
      })
      // Bots are stored in Bot table; check by username
      const allBots = await db.bot.findMany({ where: { enabled: true } })
      for (const bot of allBots) {
        const isMember = await db.channelMember.findFirst({
          where: { channelId, userId: bot.id },
        })
        if (!isMember) continue
        const isTarget = !targetBotUsername || targetBotUsername === bot.username
        if (!isTarget) continue
        // Dispatch
        await dispatchBotUpdate({
          botId: bot.id,
          channelId,
          senderId: userId,
          senderName: session.user.username || session.user.email || 'user',
          messageId: message.id,
          body: text,
          replyToId,
          isMention: false,
        })
      }
    } else {
      // Check for @mentions of bot usernames
      const mentionMatches = Array.from(text.matchAll(/@(\w+)/g))
      if (mentionMatches.length > 0) {
        const mentioned = new Set(mentionMatches.map((m) => m[1]))
        const allBots = await db.bot.findMany({ where: { enabled: true } })
        for (const bot of allBots) {
          if (!mentioned.has(bot.username)) continue
          const isMember = await db.channelMember.findFirst({
            where: { channelId, userId: bot.id },
          })
          if (!isMember) continue
          await dispatchBotUpdate({
            botId: bot.id,
            channelId,
            senderId: userId,
            senderName: session.user.username || session.user.email || 'user',
            messageId: message.id,
            body: text,
            replyToId,
            isMention: true,
          })
        }
      }
    }

    // Also dispatch visual bots on EVERY message — the trigger node
    // inside the flow decides whether to respond
    try {
      const { dispatchBotUpdate } = await import('@/lib/bot')
      const allBots = await db.bot.findMany({ where: { enabled: true, module: 'visual' } })
      for (const bot of allBots) {
        const isMember = await db.channelMember.findFirst({
          where: { channelId, userId: bot.id },
        })
        if (!isMember) continue
        await dispatchBotUpdate({
          botId: bot.id,
          channelId,
          senderId: userId,
          senderName: session.user.username || session.user.email || 'user',
          messageId: message.id,
          body: text,
          replyToId,
          isMention: false,
        })
      }
    } catch (e) {
      console.error('[bot dispatch] visual bot error', e)
    }
  } catch (e) {
    console.error('[bot dispatch] error', e)
  }

  // Fetch any bot reply messages that were created in response to the user's message
  // (and any prior dispatched bot replies). We return them so the client can
  // broadcast them via socket — otherwise other clients wouldn't see bot replies
  // in real-time.
  const botReplies = await db.message.findMany({
    where: {
      channelId,
      senderType: 'bot',
      createdAt: { gte: message.createdAt },
    },
    include: {
      sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      replyTo: {
        select: { id: true, body: true, senderType: true, sender: { select: { username: true, displayName: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Get all channel member user IDs so the client can broadcast notifications
  // to every participant (not just the sender). The sender's socket will relay
  // both the message and a notify event to each recipient.
  const memberIds = await db.channelMember.findMany({
    where: { channelId },
    select: { userId: true },
  })

  const recipientIds = memberIds.map((m) => m.userId).filter((id) => id !== userId)

  // Send push notifications to all recipients (for background notifications)
  try {
    const { sendPushNotification } = await import('@/lib/push')
    for (const recipientId of recipientIds) {
      await sendPushNotification(recipientId, {
        type: 'message',
        title: message.sender?.displayName || 'New message',
        body: message.body.slice(0, 100),
        channelId,
      })
    }
  } catch (e) {
    // Push notification failed — don't block the message
    console.error('[push] failed to send:', e)
  }

  return NextResponse.json({
    message,
    botReplies,
    recipientIds,
  })
}

// PATCH — edit a message (only the sender)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: channelId } = await params
  const { messageId, body } = await req.json()

  const msg = await db.message.findUnique({ where: { id: messageId } })
  if (!msg) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (msg.senderId !== userId || msg.senderType !== 'user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const updated = await db.message.update({
    where: { id: messageId },
    data: { body: body.slice(0, 5000), editedAt: new Date() },
  })
  return NextResponse.json({ message: updated })
}

// DELETE — soft-delete (tombstone)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: channelId } = await params
  const url = new URL(req.url)
  const messageId = url.searchParams.get('messageId')
  if (!messageId) return NextResponse.json({ error: 'missing messageId' }, { status: 400 })

  const msg = await db.message.findUnique({ where: { id: messageId } })
  if (!msg) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (msg.senderId !== userId && (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const updated = await db.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), body: '', mediaUrl: null },
  })
  return NextResponse.json({ message: updated })
}
