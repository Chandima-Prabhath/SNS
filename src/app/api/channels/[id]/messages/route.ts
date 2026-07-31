import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { canPostInChannel } from '@/lib/chat-utils'

// GET messages in a channel (paginated, oldest-first)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id: channelId } = await params
  const url = new URL(req.url)
  const before = url.searchParams.get('before') // message id for cursor
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)

  // Verify channel membership
  const membership = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (!membership) return NextResponse.json({ error: 'not a member' }, { status: 403 })

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

  // Bot dispatch
  // ─────────────────────────────────────────────────────────────────────
  // Strategy: collect the set of (botId, isMention) pairs to dispatch to,
  // dedupe by botId, then fire each dispatch once. This eliminates the
  // previous double-dispatch bug where visual bots would receive the same
  // message twice (once from the command/mention path, once from the
  // unconditional visual-bot path).
  try {
    const { dispatchBotUpdate } = await import('@/lib/bot')

    // All enabled bots that are members of this channel
    const channelBotMembers = await db.channelMember.findMany({
      where: { channelId },
      select: { userId: true },
    })
    const memberBotIds = new Set(channelBotMembers.map((m) => m.userId))
    const allBots = await db.bot.findMany({ where: { enabled: true } })
    const bots = allBots.filter((b) => memberBotIds.has(b.id))

    // Parse the message
    const commandMatch = text.match(/^\/(\w+)(?:@(\w+))?/)
    const mentionMatches: string[] = []
    for (const m of text.matchAll(/@(\w+)/g)) {
      if (m[1]) mentionMatches.push(m[1])
    }
    const mentionedSet = new Set(mentionMatches)

    // For each bot, decide if it should be dispatched and with what isMention flag.
    // Use a Map<botId, isMention> so each bot is dispatched at most once.
    const dispatches = new Map<string, boolean>()

    for (const bot of bots) {
      let isMention = false
      let shouldDispatch = false

      if (commandMatch) {
        const [, , targetBotUsername] = commandMatch
        // /cmd@botusername → only the named bot
        if (targetBotUsername) {
          if (targetBotUsername === bot.username) {
            shouldDispatch = true
          }
        } else {
          // /cmd (no @target) → dispatch to all bots in the channel
          // (the bot module / flow trigger decides whether to respond)
          shouldDispatch = true
        }
      } else if (mentionedSet.has(bot.username)) {
        // @botusername mention
        shouldDispatch = true
        isMention = true
      } else if (bot.module === 'visual') {
        // Visual bots get every message — the trigger node decides
        shouldDispatch = true
      }

      if (shouldDispatch) {
        // If we already plan to dispatch as mention, keep that flag set
        dispatches.set(bot.id, dispatches.get(bot.id) || isMention)
      }
    }

    for (const [botId, isMention] of dispatches) {
      try {
        await dispatchBotUpdate({
          botId,
          channelId,
          senderId: userId,
          senderName: session.user.username || session.user.email || 'user',
          messageId: message.id,
          body: text,
          replyToId,
          isMention,
          mediaUrl,
          mediaType,
        })
      } catch (e) {
        console.error(`[bot dispatch] bot ${botId} failed:`, e)
      }
    }
  } catch (e) {
    console.error('[bot dispatch] error', e)
  }

  // ── Auto-transcribe voice messages ──────────────────────────────────────
  // If this is an audio message, kick off transcription in the background.
  // The result is written to the Message.transcript field and a socket event
  // is emitted so all clients can show a "Show transcript" button.
  if (mediaUrl && mediaType?.startsWith('audio')) {
    // Don't await — fire and forget. The user shouldn't wait for transcription
    // to finish before their message-send request returns.
    transcribeVoiceMessage(message.id, mediaUrl, channelId).catch((e) => {
      console.error('[asr] auto-transcribe failed:', e?.message || e)
    })
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

  // Check for bot messages that were EDITED during dispatch (e.g. the
  // visual bot's wait_choice re-prompt edits the keyboard message in-place).
  // The framework tracks edited message IDs via trackEditedMessage().
  const editedMessages: any[] = []
  try {
    const { getAndClearEditedMessages } = await import('@/lib/bot/framework')
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
      const replyIds = new Set(botReplies.map((r) => r.id))
      for (const msg of edited) {
        if (!replyIds.has(msg.id)) {
          editedMessages.push(msg)
        }
      }
    }
  } catch (e) {
    console.error('[bot dispatch] error fetching edited messages:', e)
  }

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
    editedMessages,
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

// ─── Auto-transcription helper ──────────────────────────────────────────────
/**
 * Transcribe a voice message in the background, persist the transcript to the
 * Message row, and emit a socket event so all clients in the channel can
 * re-render the message with a "Show transcript" button.
 *
 * This function is intentionally NOT awaited by the message-create handler —
 * transcription can take 1–10 seconds depending on audio length and CPU, and
 * we don't want to block the message-send response.
 *
 * Failures are non-fatal: if the ASR server is down or transcription fails,
 * the message simply has no transcript (the UI shows no "Show transcript" button).
 */
async function transcribeVoiceMessage(
  messageId: string,
  mediaUrl: string,
  channelId: string,
): Promise<void> {
  const { transcribeMediaUrl } = await import('@/lib/asr')
  const transcript = await transcribeMediaUrl(mediaUrl)

  if (!transcript) {
    console.log(`[asr] no transcript for message ${messageId} (server down or empty audio)`)
    return
  }

  // Persist to the database
  await db.message.update({
    where: { id: messageId },
    data: { transcript },
  })

  // Emit a socket event so all clients in the channel update the message
  try {
    const { getIO } = await import('@/lib/realtime-server')
    const io = getIO()
    if (io) {
      io.to(`channel:${channelId}`).emit('channel:message-transcribed', {
        messageId,
        channelId,
        transcript,
      })
      console.log(`[asr] emitted transcript for ${messageId} (${transcript.length} chars)`)
    } else {
      console.warn('[asr] socket.io not initialized — transcript saved but not broadcast')
    }
  } catch (e: any) {
    console.error('[asr] failed to emit transcript:', e?.message || e)
    // The transcript is still saved — clients will see it on next reload
  }
}
