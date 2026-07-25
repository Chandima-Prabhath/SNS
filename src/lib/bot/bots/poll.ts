/**
 * Poll bot — creates simple polls using multi-step conversation state.
 *
 * Usage:
 *   /poll new        → starts a poll creation flow
 *   /poll close      → closes the active poll and shows results
 *
 * Demonstrates: command subcommands, FSM state, inline button keyboard
 */
import type { BotModule } from '../framework'

interface PollState {
  step: 'question' | 'options' | 'active' | 'closed'
  question?: string
  options?: string[]
  votes?: Record<string, number> // optionIndex → count
  voters?: string[] // userIds that have voted
}

export const pollBot: BotModule = {
  name: 'poll',
  description: 'Create simple polls in this channel.',
  commands: [
    {
      name: 'poll',
      description: 'Create or close a poll. /poll new, /poll close',
      handler: async (ctx) => {
        const sub = ctx.args[0]
        const state = (await ctx.getState()) as PollState

        if (sub === 'new') {
          await ctx.setState({ step: 'question', question: '', options: [] } as PollState)
          await ctx.reply(
            '🗳️ Poll creation started. Reply with your poll question (just type the text, no command).'
          )
          return
        }

        if (sub === 'close') {
          if (!state || state.step !== 'active') {
            await ctx.reply('No active poll to close.')
            return
          }
          const results = state
            .options!.map((opt, i) => `${opt}: ${state.votes?.[i] || 0} votes`)
            .join('\n')
          await ctx.setState({ ...state, step: 'closed' } as PollState)
          await ctx.reply(`📊 Poll closed!\n\n${state.question}\n\n${results}`)
          return
        }

        await ctx.reply('Usage: /poll new | /poll close')
      },
    },
  ],
  onMessage: async (ctx) => {
    const state = (await ctx.getState()) as PollState
    if (!state) return

    if (state.step === 'question') {
      await ctx.setState({
        step: 'options',
        question: ctx.message.body,
        options: [],
        votes: {},
        voters: [],
      } as PollState)
      await ctx.reply(
        `Question set: "${ctx.message.body}"\n\nNow send each option on its own message. Type /poll done to finish (need at least 2 options).`
      )
      return
    }

    if (state.step === 'options') {
      // Check if user typed "/poll done"
      if (ctx.message.body.startsWith('/poll')) {
        if (state.options!.length < 2) {
          await ctx.reply('Need at least 2 options. Keep sending them.')
          return
        }
        await ctx.setState({ ...state, step: 'active' } as PollState)
        const opts = state
          .options!.map((o, i) => `${i + 1}. ${o}`)
          .join('\n')
        await ctx.reply(
          `🗳️ Poll active!\n\n${state.question}\n\n${opts}\n\nType the option number to vote. Use /poll close to end.`
        )
        return
      }
      state.options!.push(ctx.message.body)
      await ctx.setState(state)
      await ctx.reply(`Added option ${state.options!.length}: ${ctx.message.body}`)
      return
    }

    if (state.step === 'active') {
      const choice = parseInt(ctx.message.body.trim(), 10)
      if (isNaN(choice) || choice < 1 || choice > state.options!.length) {
        return // silently ignore invalid votes
      }
      if (state.voters!.includes(ctx.senderId)) {
        await ctx.reply('You already voted!')
        return
      }
      const idx = choice - 1
      state.votes![idx] = (state.votes![idx] || 0) + 1
      state.voters!.push(ctx.senderId)
      await ctx.setState(state)
      await ctx.reply(`✅ Vote recorded for "${state.options![idx]}"`)
      return
    }
  },
}
