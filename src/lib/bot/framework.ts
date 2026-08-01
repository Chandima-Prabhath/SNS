/**
 * Adoo Bot Framework — Telegram-inspired, fully extensible
 *
 * Architecture:
 *   Transport adapter (REST in our case) → normalize → middleware → handler registry
 *
 * Adding a new bot = drop a file in `./bots/` exporting a BotModule.
 * The framework auto-loads all modules and routes updates to the right one.
 *
 * A BotModule is identified by its `name` and matches `Bot.module` in the DB.
 */

import { db } from '@/lib/db'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { getIO } from '@/lib/realtime-server'
import path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// Edited message tracking — used to detect which messages were edited
// during a bot dispatch so the API route can return them to the client.
// ─────────────────────────────────────────────────────────────────────────────

const editedMessageIds = new Set<string>()

/** Record that a message was edited during the current dispatch cycle.
 *  The API route calls getAndClearEditedMessages() after dispatch to
 *  return the edited messages to the client. */
export function trackEditedMessage(messageId: string) {
  editedMessageIds.add(messageId)
}

/** Returns the IDs of messages edited during this dispatch cycle, then
 *  clears the set. Called by the messages POST route and the callback
 *  route after dispatchBotUpdate/dispatchBotCallback returns. */
export function getAndClearEditedMessages(): string[] {
  const ids = Array.from(editedMessageIds)
  editedMessageIds.clear()
  return ids
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BotContext {
  bot: {
    id: string
    name: string
    username: string
    module: string
    config: any
  }
  channelId: string
  senderId: string
  senderName: string
  message: {
    id: string
    body: string
    replyToId?: string | null
    /** Media URL of the incoming message, if any (voice messages, images, etc.) */
    mediaUrl?: string | null
    /** Media MIME type of the incoming message, if any */
    mediaType?: string | null
    /** ASR transcript of the incoming voice message, if auto-transcribed */
    transcript?: string | null
  }
  args: string[]
  command?: string
  isMention: boolean

  // Helpers
  /** Reply with text + optional inline keyboard. Returns the new message ID
   *  (used by the visual bot to track which message has the active keyboard,
   *  so it can edit it in-place on re-pause instead of sending a new one). */
  reply: (text: string, keyboard?: BotKeyboard) => Promise<string>
  /** Reply with media (image/video/audio). Returns the new message ID. */
  replyWithMedia?: (mediaUrl: string, mediaType: string, caption?: string) => Promise<string>
  /** Edit an existing bot message's body + keyboard in-place. Used for
   *  Telegram-style keyboard updates (e.g. when a wait_choice loops back,
   *  we edit the existing keyboard message instead of sending a new one). */
  editMessage?: (messageId: string, text: string, keyboard?: BotKeyboard) => Promise<void>
  /** Generate TTS audio from text using Pocket TTS. Returns the media URL
   *  or null if generation failed. Server-only. */
  generateTTS?: (text: string, voice: string) => Promise<string | null>

  /** Transcribe an audio file URL to text using Moonshine ASR. Returns the
   *  transcript text or null if transcription failed. Server-only. */
  transcribeAudio?: (mediaUrl: string, language?: string) => Promise<string | null>

  /** Show a "Bot is typing..." indicator in the channel for `seconds`.
   *  Used by long-running nodes (TTS, ASR, LLM, API) to give the user
   *  visual feedback that the bot is working on their request. */
  setTyping?: (seconds: number) => Promise<void>

  /** Control the user's music player via server→client socket event. */
  controlMusic?: (targetUserId: string, command: {
    action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'
    query?: string
  }) => Promise<void>

  setState: (state: any) => Promise<void>
  getState: () => Promise<any>
}

export interface BotKeyboardButton {
  text: string
  callbackData: string
}

export type BotKeyboard = BotKeyboardButton[][]

export interface BotCommand {
  name: string
  description: string
  handler: (ctx: BotContext) => Promise<void>
}

export interface BotCallbackHandler {
  pattern: string | RegExp
  handler: (ctx: BotContext, data: string) => Promise<void>
}

export interface BotMiddleware {
  name: string
  run: (ctx: BotContext, next: () => Promise<void>) => Promise<void>
}

export interface BotModule {
  name: string
  description: string
  commands: BotCommand[]
  callbacks?: BotCallbackHandler[]
  onMessage?: (ctx: BotContext) => Promise<void> // for non-command messages
  middlewares?: BotMiddleware[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

const modules = new Map<string, BotModule>()

export function registerBotModule(mod: BotModule) {
  modules.set(mod.name, mod)
  console.log(`[bot] registered module: ${mod.name} (${mod.commands.length} commands)`)
}

export function getBotModule(name: string): BotModule | undefined {
  return modules.get(name)
}

export function listBotModules(): BotModule[] {
  return Array.from(modules.values())
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

const COMMAND_REGEX = /^\/(\w+)(@\w+)?\s*(.*)$/

export async function dispatchBotUpdate(params: {
  botId: string
  channelId: string
  senderId: string
  senderName: string
  messageId: string
  body: string
  replyToId?: string | null
  isMention?: boolean
  /** Media URL of the incoming message (voice messages, images, etc.) */
  mediaUrl?: string | null
  /** Media type of the incoming message (audio/webm, image/png, etc.) */
  mediaType?: string | null
  /** ASR transcript of the incoming voice message, if auto-transcription is enabled */
  transcript?: string | null
}): Promise<void> {
  const bot = await db.bot.findUnique({ where: { id: params.botId } })
  if (!bot || !bot.enabled) return

  const mod = getBotModule(bot.module)
  if (!mod) {
    console.warn(`[bot] module "${bot.module}" not registered for bot ${bot.username}`)
    return
  }

  let config: any = {}
  try {
    config = JSON.parse(bot.config || '{}')
  } catch {
    config = {}
  }

  // Pass the flow to visual bots
  if (bot.module === 'visual' && bot.flow) {
    config._flow = bot.flow
  }

  // Helper: post a message as the bot
  // If keyboard is provided, it's persisted as JSON on the message row and
  // rendered as tappable Telegram-style inline buttons by the client.
  // Returns the new message ID (used by visual bot to track the active
  // keyboard message for edit-in-place on re-pause).
  const reply = async (text: string, keyboard?: BotKeyboard): Promise<string> => {
    const msg = await db.message.create({
      data: {
        channelId: params.channelId,
        senderType: 'bot',
        senderId: bot.id,
        body: text,
        replyToId: params.messageId,
        keyboard: keyboard && keyboard.length > 0 ? JSON.stringify(keyboard) : null,
      },
    })
    return msg.id
  }

  // Helper: edit an existing bot message's body + keyboard in-place.
  // Used for Telegram-style keyboard updates — when a wait_choice loops
  // back, we edit the existing keyboard message instead of sending a new
  // one. Also broadcasts a socket event so all clients update in real-time.
  const editMessage = async (messageId: string, text: string, keyboard?: BotKeyboard) => {
    await db.message.update({
      where: { id: messageId },
      data: {
        body: text,
        keyboard: keyboard && keyboard.length > 0 ? JSON.stringify(keyboard) : null,
      },
    })
    trackEditedMessage(messageId)
  }

  // Helper: reply with media (image/video/audio). Used by the TTS node
  // to send voice messages. Returns the new message ID.
  const replyWithMedia = async (mediaUrl: string, mediaType: string, caption?: string): Promise<string> => {
    const msg = await db.message.create({
      data: {
        channelId: params.channelId,
        senderType: 'bot',
        senderId: bot.id,
        body: caption || (mediaType === 'audio' ? 'Voice message' : 'Media'),
        replyToId: params.messageId,
        mediaUrl,
        mediaType,
      },
    })
    return msg.id
  }

  // Helper: generate TTS audio via Pocket TTS, save to disk, return URL.
  // Server-only — uses fs/path to write the WAV file to public/uploads/.
  const generateTTS = async (text: string, voice: string): Promise<string | null> => {
    try {
      const ttsUrl = process.env.TTS_URL || 'http://localhost:8000'
      const formData = new FormData()
      formData.append('text', text.slice(0, 500))
      formData.append('voice_url', voice)

      // 30s timeout — Pocket TTS should respond in <5s. If it hangs, abort
      // and return null so the bot falls back to a text message.
      const ttsController = new AbortController()
      const ttsTimeout = setTimeout(() => ttsController.abort(), 30_000)
      const ttsRes = await fetch(`${ttsUrl}/tts`, {
        method: 'POST',
        body: formData,
        signal: ttsController.signal,
      })
      clearTimeout(ttsTimeout)

      if (!ttsRes.ok) {
        console.error(`[bot:tts] TTS server error ${ttsRes.status}`)
        return null
      }

      const audioBuffer = Buffer.from(await ttsRes.arrayBuffer())
      if (audioBuffer.length === 0) {
        console.error('[bot:tts] TTS returned empty audio')
        return null
      }

      const uploadDir = path.join(process.cwd(), 'public', 'uploads')
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true })
      }
      const filename = `tts-bot-${crypto.randomUUID()}.wav`
      await writeFile(path.join(uploadDir, filename), audioBuffer)

      return `/api/uploads/${filename}`
    } catch (e: any) {
      console.error('[bot:tts] failed:', e?.message || e)
      return null
    }
  }

  // Helper: transcribe audio via Moonshine ASR Python sidecar.
  // Returns the transcript text or null on failure. Server-only.
  const transcribeAudio = async (mediaUrl: string, language?: string): Promise<string | null> => {
    try {
      const { transcribeMediaUrl } = await import('@/lib/asr')
      return await transcribeMediaUrl(mediaUrl, language || 'en')
    } catch (e: any) {
      console.error('[bot:asr] failed:', e?.message || e)
      return null
    }
  }

  // Helper: emit a "Bot is typing..." indicator to the channel via socket.
  // Re-emits every 4 seconds (Telegram-style) until the timeout expires,
  // because the chat UI auto-clears typing after ~5s of no refresh.
  const typingTimers = new Map<string, ReturnType<typeof setInterval>>()
  const setTyping = async (seconds: number) => {
    try {
      const io = getIO()
      if (!io) return

      const room = `channel:${params.channelId}`
      const typingPayload = {
        userId: bot.id,
        username: bot.username,
        channelId: params.channelId,
        isTyping: true,
      }

      // Clear any existing typing timer for this bot
      const existing = typingTimers.get(bot.id)
      if (existing) clearInterval(existing)

      // Emit immediately
      io.to(room).emit('channel:typing', typingPayload)

      // Re-emit every 4s until the timeout expires
      const intervalMs = 4000
      const endTime = Date.now() + Math.min(seconds, 30) * 1000 // cap at 30s
      const interval = setInterval(() => {
        if (Date.now() >= endTime) {
          clearInterval(interval)
          typingTimers.delete(bot.id)
          io.to(room).emit('channel:typing', { ...typingPayload, isTyping: false })
          return
        }
        io.to(room).emit('channel:typing', typingPayload)
      }, intervalMs)
      typingTimers.set(bot.id, interval)
    } catch (e: any) {
      // Best-effort — don't let typing indicator failures break the bot
      console.warn('[bot:typing] failed:', e?.message || e)
    }
  }

  // Helper: control the user's music player via socket event
  const controlMusic = async (targetUserId: string, command: {
    action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'
    query?: string
  }) => {
    try {
      const io = getIO()
      if (!io) return
      // Emit to the target user's sockets via the presence map
      io.emit('music:bot-command', { targetUserId, command })
    } catch (e: any) {
      console.warn('[bot:music] failed:', e?.message || e)
    }
  }

  // Helper: state management
  const stateKey = { botId: bot.id, userId: params.senderId }
  const getState = async () => {
    const session = await db.conversationSession.findUnique({ where: { botId_userId: stateKey } })
    if (!session) return {}
    try {
      return JSON.parse(session.state || '{}')
    } catch {
      return {}
    }
  }
  const setState = async (state: any) => {
    await db.conversationSession.upsert({
      where: { botId_userId: stateKey },
      create: { ...stateKey, state: JSON.stringify(state) },
      update: { state: JSON.stringify(state) },
    })
  }

  // Parse command
  const match = params.body.match(COMMAND_REGEX)
  const isCommand = !!match

  let command: string | undefined
  let args: string[] = []
  if (match) {
    command = match[1]
    const argsStr = match[3].trim()
    args = argsStr ? argsStr.split(/\s+/) : []
  }

  const ctx: BotContext = {
    bot: {
      id: bot.id,
      name: bot.name,
      username: bot.username,
      module: bot.module,
      config,
    },
    channelId: params.channelId,
    senderId: params.senderId,
    senderName: params.senderName,
    message: {
      id: params.messageId,
      body: params.body,
      replyToId: params.replyToId,
      mediaUrl: params.mediaUrl,
      mediaType: params.mediaType,
      transcript: params.transcript,
    },
    args,
    command,
    isMention: !!params.isMention,
    reply,
    replyWithMedia,
    editMessage,
    generateTTS,
    transcribeAudio,
    setTyping,
    controlMusic,
    getState,
    setState,
  }

  // Run middleware chain
  const middlewares = mod.middlewares || []
  let chain: () => Promise<void> = async () => {
    // Visual bots ALWAYS get onMessage — the visual flow's trigger node
    // handles command/mention filtering. We must NOT short-circuit on
    // commands here, otherwise /commands and @mentions never reach the
    // visual flow engine.
    if (bot.module === 'visual') {
      if (mod.onMessage) {
        await mod.onMessage(ctx)
      }
      return
    }

    // Non-visual bots: check for command handlers first
    if (isCommand && command) {
      const cmd = mod.commands.find((c) => c.name === command)
      if (cmd) {
        await cmd.handler(ctx)
        return
      }
      // Unknown command — only respond if no privacy mode or direct mention
      if (!bot.privacyMode || ctx.isMention) {
        await ctx.reply(
          `Unknown command: /${command}\nType /help to see what I can do.`
        )
      }
      return
    }

    // Non-command message for non-visual bots
    // Visual bots ALWAYS get onMessage — the trigger node handles filtering
    if (mod.onMessage) {
      if (bot.module === 'visual' || !bot.privacyMode || ctx.isMention) {
        await mod.onMessage(ctx)
      }
    }
  }

  // Apply middlewares in reverse
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i]
    const next = chain
    chain = () => mw.run(ctx, next)
  }

  await chain()
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback dispatcher — handles inline keyboard button clicks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a callback (inline button click) to a bot.
 *
 * When a user taps an inline button on a bot message, the client POSTs to
 * /api/channels/:id/messages/:messageId/callback with { callbackData, botId }.
 * This function:
 *   1. Loads the bot
 *   2. Builds a BotContext with the callbackData as the message body
 *   3. If the bot is a visual bot, routes to onMessage (which handles the
 *      paused wait_choice resume path)
 *   4. Otherwise, calls the first matching callback handler in the module
 *
 * Returns the bot replies created during dispatch (same pattern as
 * dispatchBotUpdate).
 */
export async function dispatchBotCallback(params: {
  botId: string
  channelId: string
  senderId: string
  senderName: string
  messageId: string // the message that contained the keyboard
  callbackData: string // the button's callbackData value
  replyToId?: string | null
}): Promise<void> {
  const bot = await db.bot.findUnique({ where: { id: params.botId } })
  if (!bot || !bot.enabled) return

  let config: any = {}
  try {
    config = bot.config ? JSON.parse(bot.config) : {}
  } catch {
    config = {}
  }

  // Pass the flow to visual bots
  if (bot.module === 'visual' && bot.flow) {
    config._flow = bot.flow
  }

  const reply = async (text: string, keyboard?: BotKeyboard): Promise<string> => {
    const msg = await db.message.create({
      data: {
        channelId: params.channelId,
        senderType: 'bot',
        senderId: bot.id,
        body: text,
        replyToId: params.messageId,
        keyboard: keyboard && keyboard.length > 0 ? JSON.stringify(keyboard) : null,
      },
    })
    return msg.id
  }

  const editMessage = async (messageId: string, text: string, keyboard?: BotKeyboard) => {
    await db.message.update({
      where: { id: messageId },
      data: {
        body: text,
        keyboard: keyboard && keyboard.length > 0 ? JSON.stringify(keyboard) : null,
      },
    })
    trackEditedMessage(messageId)
  }

  const replyWithMedia = async (mediaUrl: string, mediaType: string, caption?: string): Promise<string> => {
    const msg = await db.message.create({
      data: {
        channelId: params.channelId,
        senderType: 'bot',
        senderId: bot.id,
        body: caption || (mediaType === 'audio' ? 'Voice message' : 'Media'),
        replyToId: params.messageId,
        mediaUrl,
        mediaType,
      },
    })
    return msg.id
  }

  const generateTTS = async (text: string, voice: string): Promise<string | null> => {
    try {
      const ttsUrl = process.env.TTS_URL || 'http://localhost:8000'
      const formData = new FormData()
      formData.append('text', text.slice(0, 500))
      formData.append('voice_url', voice)

      // 30s timeout — Pocket TTS should respond in <5s. If it hangs, abort
      // and return null so the bot falls back to a text message.
      const ttsController = new AbortController()
      const ttsTimeout = setTimeout(() => ttsController.abort(), 30_000)
      const ttsRes = await fetch(`${ttsUrl}/tts`, {
        method: 'POST',
        body: formData,
        signal: ttsController.signal,
      })
      clearTimeout(ttsTimeout)

      if (!ttsRes.ok) return null

      const audioBuffer = Buffer.from(await ttsRes.arrayBuffer())
      if (audioBuffer.length === 0) return null

      const uploadDir = path.join(process.cwd(), 'public', 'uploads')
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true })
      }
      const filename = `tts-bot-${crypto.randomUUID()}.wav`
      await writeFile(path.join(uploadDir, filename), audioBuffer)

      return `/api/uploads/${filename}`
    } catch (e: any) {
      console.error('[bot:tts callback] failed:', e?.message || e)
      return null
    }
  }

  // Helper: transcribe audio via Moonshine ASR (duplicate of dispatchBotUpdate
  // version — kept inline because framework.ts doesn't extract helpers yet)
  const transcribeAudio = async (mediaUrl: string, language?: string): Promise<string | null> => {
    try {
      const { transcribeMediaUrl } = await import('@/lib/asr')
      return await transcribeMediaUrl(mediaUrl, language || 'en')
    } catch (e: any) {
      console.error('[bot:asr callback] failed:', e?.message || e)
      return null
    }
  }

  // Helper: emit typing indicator (duplicate of dispatchBotUpdate version)
  const setTyping = async (seconds: number) => {
    try {
      const io = getIO()
      if (!io) return
      const room = `channel:${params.channelId}`
      const typingPayload = {
        userId: bot.id,
        username: bot.username,
        channelId: params.channelId,
        isTyping: true,
      }
      io.to(room).emit('channel:typing', typingPayload)
      // Auto-clear after the requested duration (capped at 30s)
      const ms = Math.min(seconds, 30) * 1000
      setTimeout(() => {
        try {
          io.to(room).emit('channel:typing', { ...typingPayload, isTyping: false })
        } catch {}
      }, ms)
    } catch (e: any) {
      console.warn('[bot:typing callback] failed:', e?.message || e)
    }
  }

  // Helper: control the user's music player via socket event (duplicate of
  // dispatchBotUpdate version — kept inline because framework.ts duplicates helpers)
  const controlMusic = async (targetUserId: string, command: {
    action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'
    query?: string
  }) => {
    try {
      const io = getIO()
      if (!io) return
      io.emit('music:bot-command', { targetUserId, command })
    } catch (e: any) {
      console.warn('[bot:music callback] failed:', e?.message || e)
    }
  }

  const stateKey = { botId: bot.id, userId: params.senderId }
  const getState = async () => {
    const session = await db.conversationSession.findUnique({ where: { botId_userId: stateKey } })
    if (!session) return {}
    try {
      return JSON.parse(session.state || '{}')
    } catch {
      return {}
    }
  }
  const setState = async (state: any) => {
    await db.conversationSession.upsert({
      where: { botId_userId: stateKey },
      create: { ...stateKey, state: JSON.stringify(state) },
      update: { state: JSON.stringify(state) },
    })
  }

  const ctx: BotContext = {
    bot: {
      id: bot.id,
      name: bot.name,
      username: bot.username,
      module: bot.module,
      config,
    },
    channelId: params.channelId,
    senderId: params.senderId,
    senderName: params.senderName,
    message: {
      id: params.messageId,
      body: params.callbackData, // the callbackData acts as the "message body" for the resume path
      replyToId: params.replyToId,
    },
    args: [],
    command: undefined,
    isMention: false,
    reply,
    replyWithMedia,
    editMessage,
    generateTTS,
    transcribeAudio,
    setTyping,
    controlMusic,
    getState,
    setState,
  }

  const mod = getBotModule(bot.module)
  if (!mod) {
    console.log(`[callback] bot module '${bot.module}' not found`)
    return
  }

  console.log(`[callback] dispatching to module '${bot.module}', routing to onMessage...`)

  // For visual bots, route to onMessage — the wait_choice resume path in
  // visual.ts will match the callbackData against the options.
  if (mod.onMessage && bot.module === 'visual') {
    try {
      await mod.onMessage(ctx)
      console.log(`[callback] onMessage completed`)
    } catch (e: any) {
      console.error('[callback] onMessage error:', e)
    }
    return
  }

  // For non-visual bots, try callback handlers
  if (mod.callbacks) {
    for (const cb of mod.callbacks) {
      const pattern = typeof cb.pattern === 'string' ? new RegExp(`^${cb.pattern}$`) : cb.pattern
      if (pattern.test(params.callbackData)) {
        await cb.handler(ctx, params.callbackData)
        return
      }
    }
  }
}
