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
  }
  args: string[]
  command?: string
  isMention: boolean

  // Helpers
  reply: (text: string, keyboard?: BotKeyboard) => Promise<void>
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
  const reply = async (text: string, keyboard?: BotKeyboard) => {
    await db.message.create({
      data: {
        channelId: params.channelId,
        senderType: 'bot',
        senderId: bot.id,
        body: text,
        replyToId: params.messageId,
        keyboard: keyboard && keyboard.length > 0 ? JSON.stringify(keyboard) : null,
      },
    })
    // Note: socket relay is handled by the calling REST route after dispatch returns
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
    },
    args,
    command,
    isMention: !!params.isMention,
    reply,
    getState,
    setState,
  }

  // Run middleware chain
  const middlewares = mod.middlewares || []
  let chain: () => Promise<void> = async () => {
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

    // Non-command message
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

  const reply = async (text: string, keyboard?: BotKeyboard) => {
    await db.message.create({
      data: {
        channelId: params.channelId,
        senderType: 'bot',
        senderId: bot.id,
        body: text,
        replyToId: params.messageId,
        keyboard: keyboard && keyboard.length > 0 ? JSON.stringify(keyboard) : null,
      },
    })
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
