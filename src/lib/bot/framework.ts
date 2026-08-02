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
import { getIO, sendMusicCommand } from '@/lib/realtime-server'
import path from 'path'
import { AsyncLocalStorage } from 'node:async_hooks'
import crypto from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Edited message tracking — used to detect which messages were edited
// during a bot dispatch so the API route can return them to the client.
// ─────────────────────────────────────────────────────────────────────────────
//
// CRITICAL FIX: previously this was a module-level Set shared across ALL
// concurrent dispatches. Two users triggering the same bot at the same time
// would have their edited-message IDs merged into one set — the first
// dispatch to call getAndClearEditedMessages() drained BOTH sets, and the
// second dispatch got an empty set (its UI never saw the edit).
//
// AsyncLocalStorage gives us per-request isolation: each dispatchBotUpdate /
// dispatchBotCallback call runs inside its own ALS context, and
// trackEditedMessage writes to that context's set — not the global one.
// Calls outside a dispatch (none should exist) fall through to a noop set.

interface DispatchContext {
  editedMessageIds: Set<string>
  botReplyIds: Set<string>
}
const dispatchAls = new AsyncLocalStorage<DispatchContext>()

/** Record that a message was edited during the current dispatch cycle.
 *  The API route calls getAndClearEditedMessages() after dispatch to
 *  return the edited messages to the client. */
export function trackEditedMessage(messageId: string) {
  dispatchAls.getStore()?.editedMessageIds.add(messageId)
}

/** Track a bot reply message ID so the API route can fetch them precisely
 *  instead of using a timestamp window (which races with concurrent
 *  dispatches in the same channel). */
export function trackBotReply(messageId: string) {
  dispatchAls.getStore()?.botReplyIds.add(messageId)
}

/** Returns the IDs of messages edited during this dispatch cycle, then
 *  clears the set. Called by the messages POST route and the callback
 *  route after dispatchBotUpdate/dispatchBotCallback returns. */
export function getAndClearEditedMessages(): string[] {
  const store = dispatchAls.getStore()
  if (!store) return []
  const ids = Array.from(store.editedMessageIds)
  store.editedMessageIds.clear()
  return ids
}

/** Returns the IDs of bot replies created during this dispatch cycle. */
export function getAndClearBotReplyIds(): string[] {
  const store = dispatchAls.getStore()
  if (!store) return []
  const ids = Array.from(store.botReplyIds)
  store.botReplyIds.clear()
  return ids
}

/** Run a function inside a fresh dispatch context (isolated edited/reply
 *  tracking). Used by dispatchBotUpdate and dispatchBotCallback. */
function withDispatchContext<T>(fn: () => Promise<T>): Promise<T> {
  const store: DispatchContext = {
    editedMessageIds: new Set(),
    botReplyIds: new Set(),
  }
  return dispatchAls.run(store, fn)
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
    if (process.env.NODE_ENV === 'development') console.log(`[bot] registered module: ${mod.name} (${mod.commands.length} commands)`)
}

export function getBotModule(name: string): BotModule | undefined {
  return modules.get(name)
}

export function listBotModules(): BotModule[] {
  return Array.from(modules.values())
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared context builder — used by both dispatchBotUpdate and dispatchBotCallback
// ─────────────────────────────────────────────────────────────────────────────

const COMMAND_REGEX = /^\/(\w+)(@\w+)?\s*(.*)$/

// Module-level typing timers — keyed by botId, so they survive across
// dispatches and can be cleared when a new dispatch starts.
const typingTimers = new Map<string, ReturnType<typeof setInterval>>()

interface DispatchParams {
  channelId: string
  senderId: string
  senderName: string
  messageId: string
  replyToId?: string | null
}

/**
 * Build a BotContext with all shared helpers (reply, editMessage, replyWithMedia,
 * generateTTS, transcribeAudio, setTyping, controlMusic, getState, setState).
 *
 * Both dispatchBotUpdate and dispatchBotCallback call this — eliminates ~250
 * lines of duplicated code and prevents the helpers from silently diverging
 * (which previously caused the music bot controlMusic bug).
 */
function buildBotContext(bot: any, params: DispatchParams): BotContext {
  // Helper: post a message as the bot
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
    trackBotReply(msg.id)
    return msg.id
  }

  // Helper: edit an existing bot message's body + keyboard in-place
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

  // Helper: reply with media (image/video/audio)
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
    trackBotReply(msg.id)
    return msg.id
  }

  // Helper: generate TTS audio via Pocket TTS, save to disk, return URL
  const generateTTS = async (text: string, voice: string): Promise<string | null> => {
    try {
      const ttsUrl = process.env.TTS_URL || 'http://localhost:8000'
      const formData = new FormData()
      formData.append('text', text.slice(0, 500))
      formData.append('voice_url', voice)

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
      if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })
      const filename = `tts-bot-${crypto.randomUUID()}.wav`
      await writeFile(path.join(uploadDir, filename), audioBuffer)
      return `/api/uploads/${filename}`
    } catch (e: any) {
      console.error('[bot:tts] failed:', e?.message || e)
      return null
    }
  }

  // Helper: transcribe audio via Moonshine ASR
  const transcribeAudio = async (mediaUrl: string, language?: string): Promise<string | null> => {
    try {
      const { transcribeMediaUrl } = require('@/lib/asr')
      return await transcribeMediaUrl(mediaUrl, language || 'en')
    } catch (e: any) {
      console.error('[bot:asr] failed:', e?.message || e)
      return null
    }
  }

  // Helper: show typing indicator (re-emits every 4s until timeout)
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
      // Key by bot+channel — multiple channels using the same bot no
      // longer interfere (previously the second dispatch's setTyping
      // would clear the first dispatch's typing timer).
      const timerKey = `${bot.id}:${params.channelId}`
      const existing = typingTimers.get(timerKey)
      if (existing) clearInterval(existing)
      // Emit immediately
      io.to(room).emit('channel:typing', typingPayload)
      // Re-emit every 4s until the timeout expires
      const endTime = Date.now() + Math.min(seconds, 30) * 1000
      const interval = setInterval(() => {
        if (Date.now() >= endTime) {
          clearInterval(interval)
          typingTimers.delete(timerKey)
          io.to(room).emit('channel:typing', { ...typingPayload, isTyping: false })
          return
        }
        io.to(room).emit('channel:typing', typingPayload)
      }, 4000)
      typingTimers.set(timerKey, interval)
    } catch (e: any) {
      console.warn('[bot:typing] failed:', e?.message || e)
    }
  }

  // Helper: control music player via socket
  const controlMusic = async (targetUserId: string, command: {
    action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'
    query?: string
  }) => {
    try {
      sendMusicCommand(targetUserId, command)
    } catch (e: any) {
      console.warn('[bot:music] failed:', e?.message || e)
    }
  }

  // Helper: state management — scoped by channelId so the same user's
  // bot sessions in different channels don't interfere (paused flows,
  // poll votes, counters all stay isolated per-channel).
  const stateKey = { botId: bot.id, userId: params.senderId, channelId: params.channelId }
  const getState = async () => {
    const session = await db.conversationSession.findUnique({ where: { botId_userId_channelId: stateKey } })
    if (!session) return {}
    try { return JSON.parse(session.state || '{}') } catch { return {} }
  }
  const setState = async (state: any) => {
    await db.conversationSession.upsert({
      where: { botId_userId_channelId: stateKey },
      create: { ...stateKey, state: JSON.stringify(state) },
      update: { state: JSON.stringify(state) },
    })
  }

  return {
    bot: {
      id: bot.id,
      name: bot.name,
      username: bot.username,
      module: bot.module,
      config: bot.config ? (typeof bot.config === 'string' ? JSON.parse(bot.config) : bot.config) : {},
    },
    channelId: params.channelId,
    senderId: params.senderId,
    senderName: params.senderName,
    message: {
      id: params.messageId,
      body: '', // set by caller
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

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
  // Wrap the entire dispatch in an isolated ALS context so concurrent
  // dispatches don't cross-contaminate edited-message-ID tracking.
  return withDispatchContext(async () => {
    await _dispatchBotUpdateImpl(params)
  })
}

async function _dispatchBotUpdateImpl(params: Parameters<typeof dispatchBotUpdate>[0]): Promise<void> {
  const bot = await db.bot.findUnique({ where: { id: params.botId } })
  if (!bot || !bot.enabled) return

  const mod = getBotModule(bot.module)
  if (!mod) {
    console.warn(`[bot] module "${bot.module}" not registered for bot ${bot.username}`)
    return
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

  // Build shared context using the extracted helper
  const ctx = buildBotContext(bot, {
    channelId: params.channelId,
    senderId: params.senderId,
    senderName: params.senderName,
    messageId: params.messageId,
    replyToId: params.replyToId,
  })

  // Override message body + command-specific fields
  ctx.message.body = params.body
  ctx.message.mediaUrl = params.mediaUrl
  ctx.message.mediaType = params.mediaType
  ctx.message.transcript = params.transcript
  ctx.args = args
  ctx.command = command
  ctx.isMention = !!params.isMention

  // Pass the flow to visual bots via config
  if (bot.module === 'visual' && bot.flow) {
    ctx.bot.config._flow = bot.flow
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
  // Wrap in isolated ALS context for the same reason as dispatchBotUpdate.
  return withDispatchContext(async () => {
    await _dispatchBotCallbackImpl(params)
  })
}

async function _dispatchBotCallbackImpl(params: Parameters<typeof dispatchBotCallback>[0]): Promise<void> {
  const bot = await db.bot.findUnique({ where: { id: params.botId } })
  if (!bot || !bot.enabled) return

  const mod = getBotModule(bot.module)
  if (!mod) {
        console.warn(`[callback] bot module '${bot.module}' not found`)
    return
  }

  // Build shared context using the extracted helper
  const ctx = buildBotContext(bot, {
    channelId: params.channelId,
    senderId: params.senderId,
    senderName: params.senderName,
    messageId: params.messageId,
    replyToId: params.replyToId,
  })

  // Override: callbackData acts as the message body for the resume path
  ctx.message.body = params.callbackData

  // Pass the flow to visual bots via config
  if (bot.module === 'visual' && bot.flow) {
    ctx.bot.config._flow = bot.flow
  }

  

  // For visual bots, route to onMessage — the wait_choice resume path in
  // visual.ts will match the callbackData against the options.
  if (mod.onMessage) {
    await mod.onMessage(ctx)
  }

  // Also check explicit callback handlers (non-visual bots)
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
