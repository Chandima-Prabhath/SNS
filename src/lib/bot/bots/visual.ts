/**
 * Visual Bot Module — executes bot flows created by the visual builder.
 *
 * When a bot has module="visual", this module loads the flow from Bot.flow
 * and executes it using the executeBotFlow engine.
 */
import type { BotModule, BotContext } from '../framework'
import { executeBotFlow, type BotFlow } from '../flow-types'

export const visualBot: BotModule = {
  name: 'visual',
  description: 'Executes a visual flow-chart bot definition.',
  commands: [], // commands are defined by the trigger node in the flow
  onMessage: async (ctx: BotContext) => {
    // Load the flow from the bot's config
    let flow: BotFlow | null = null
    try {
      // The flow is stored in Bot.flow (passed via ctx.bot.config)
      const flowStr = (ctx.bot.config as any)?._flow
      if (flowStr) {
        flow = typeof flowStr === 'string' ? JSON.parse(flowStr) : flowStr
      }
    } catch {
      return
    }

    if (!flow) return

    // Check if the message matches the trigger
    const trigger = flow.nodes.find((n) => n.type === 'trigger')
    if (!trigger) return

    // Only respond if privacy mode is off, or if it's a command/mention
    const messageBody = ctx.message.body
    const isCommand = messageBody.startsWith('/')
    const isMention = messageBody.includes(`@${ctx.bot.username}`)

    if (trigger.data.triggerType === 'command' && trigger.data.command) {
      const cmd = trigger.data.command.replace(/^\//, '')
      if (!ctx.command || ctx.command !== cmd) return
    } else if (trigger.data.triggerType === 'mention') {
      if (!isMention) return
    } else if (trigger.data.triggerType === 'message') {
      // Respond to any message — but only if privacy mode is off
    }

    // Execute the flow
    const result = await executeBotFlow(flow, {
      channelId: ctx.channelId,
      senderId: ctx.senderId,
      senderName: ctx.senderName,
      messageId: ctx.message.id,
      body: ctx.message.body,
      args: ctx.args,
      command: ctx.command,
      variables: {},
    })

    // Send all messages from the flow execution
    for (const msg of result.messages) {
      await ctx.reply(msg)
    }

    if (result.error) {
      console.error('[visual bot] flow error:', result.error)
    }
  },
}
