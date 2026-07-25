/**
 * Echo bot — minimal example. Replies with the same text.
 * Useful for testing the bot framework end-to-end.
 */
import type { BotModule } from '../framework'

export const echoBot: BotModule = {
  name: 'echo',
  description: 'Repeats whatever you say back to you.',
  commands: [
    {
      name: 'echo',
      description: 'Echo back the text you provide',
      handler: async (ctx) => {
        const text = ctx.args.join(' ').trim()
        if (!text) {
          await ctx.reply('Usage: /echo <text>')
          return
        }
        await ctx.reply(`🔊 ${text}`)
      },
    },
  ],
  onMessage: async (ctx) => {
    // When mentioned without a command, echo the message
    await ctx.reply(`(echo) ${ctx.message.body}`)
  },
}
