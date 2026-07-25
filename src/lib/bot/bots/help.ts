/**
 * Help bot — shows available commands across all registered bots in this channel.
 * Use /help to list commands. Use /help <botname> for details.
 */
import { listBotModules, type BotModule } from '../framework'

export const helpBot: BotModule = {
  name: 'help',
  description: 'Lists available commands across all bots.',
  commands: [
    {
      name: 'help',
      description: 'Show this help message',
      handler: async (ctx) => {
        const target = ctx.args[0]?.replace(/^@/, '')
        if (target) {
          const mod = listBotModules().find((m) => m.name === target)
          if (!mod) {
            await ctx.reply(`No bot named "${target}" found.`)
            return
          }
          const lines = mod.commands.map((c) => `  /${c.name} — ${c.description}`)
          await ctx.reply(`🤖 ${mod.name}: ${mod.description}\n\nCommands:\n${lines.join('\n')}`)
          return
        }
        const all = listBotModules()
        const lines = all.map((m) => {
          const cmds = m.commands.map((c) => `/${c.name}`).join(', ')
          return `• ${m.name} — ${m.description}\n  ${cmds}`
        })
        await ctx.reply(`📚 Available bots (${all.length}):\n\n${lines.join('\n\n')}`)
      },
    },
  ],
}
