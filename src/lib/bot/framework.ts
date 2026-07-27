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
  const reply = async (text: string, keyboard?: BotKeyboard) => {
    await db.message.create({
      data: {
        channelId: params.channelId,
        senderType: 'bot',
        senderId: bot.id,
        body: keyboard && keyboard.length > 0
          ? `${text}\n\n${keyboard.flat().map(b => `[${b.text}]`).join('  ')}`
          : text,
        replyToId: params.messageId,
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
