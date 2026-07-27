/**
 * Visual Bot Module — executes bot flows created by the visual builder.
 *
 * The flow is stored in Bot.flow (JSON string) and passed via config._flow
 * by the framework dispatcher.
 */
import type { BotModule, BotContext } from '../framework'
import { executeBotFlow, type BotFlow } from '../flow-types'

export const visualBot: BotModule = {
  name: 'visual',
  description: 'Executes a visual flow-chart bot definition.',
  commands: [],
  onMessage: async (ctx: BotContext) => {
    console.log('[visual bot] onMessage called, bot:', ctx.bot.name)

    // Load the flow — it's passed via config._flow by the framework
    let flow: BotFlow | null = null
    const flowData = (ctx.bot.config as any)?._flow
    if (flowData) {
      try {
        flow = typeof flowData === 'string' ? JSON.parse(flowData) : flowData
      } catch (e) {
        console.error('[visual bot] failed to parse flow:', e)
        return
      }
    }

    if (!flow) {
      console.log('[visual bot] no flow found for bot', ctx.bot.name)
      return
    }

    if (!flow.nodes || flow.nodes.length === 0) {
      console.log('[visual bot] flow has no nodes')
      return
    }

    console.log('[visual bot] executing flow with', flow.nodes.length, 'nodes')

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

    console.log('[visual bot] execution result:', result.messages.length, 'messages')

    // Send all messages from the flow execution
    for (const msg of result.messages) {
      await ctx.reply(msg)
    }

    if (result.error) {
      console.error('[visual bot] flow error:', result.error)
    }
  },
}
