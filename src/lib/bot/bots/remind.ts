/**
 * Reminder bot — schedules text reminders using setTimeout (in-memory).
 *
 * Note: For production you'd want a persistent job queue. For a small friend
 * group on a single instance, in-memory is fine. If the server restarts,
 * pending reminders are lost (which matches user expectation for a simple tool).
 *
 * Usage: /remind <minutes> <text>
 *   e.g. /remind 30 Take pizza out of the oven
 */
import type { BotModule } from '../framework'

const activeTimers = new Map<string, NodeJS.Timeout>()

export const reminderBot: BotModule = {
  name: 'remind',
  description: 'Sets a simple reminder. /remind <minutes> <text>',
  commands: [
    {
      name: 'remind',
      description: 'Set a reminder. /remind <minutes> <text>',
      handler: async (ctx) => {
        const mins = parseInt(ctx.args[0] || '', 10)
        const text = ctx.args.slice(1).join(' ').trim()

        if (isNaN(mins) || mins <= 0 || !text) {
          await ctx.reply('Usage: /remind <minutes> <text>\nExample: /remind 30 Take pizza out')
          return
        }

        if (mins > 1440) {
          await ctx.reply('Max reminder is 24 hours (1440 minutes).')
          return
        }

        const timerKey = `${ctx.bot.id}:${ctx.senderId}:${Date.now()}`
        const ms = mins * 60 * 1000

        await ctx.reply(`⏰ Got it! I'll remind you in ${mins} minute${mins === 1 ? '' : 's'}: "${text}"`)

        const t = setTimeout(async () => {
          try {
            const { db } = await import('@/lib/db')
            await db.message.create({
              data: {
                channelId: ctx.channelId,
                senderType: 'bot',
                senderId: ctx.bot.id,
                body: `⏰ Reminder for @${ctx.senderName}: ${text}`,
              },
            })
          } catch (e) {
            console.error('[reminder] failed to fire', e)
          }
          activeTimers.delete(timerKey)
        }, ms)

        activeTimers.set(timerKey, t)
      },
    },
  ],
}
