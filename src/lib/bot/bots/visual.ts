/**
 * Visual Bot Module — executes visual flows created by the bot builder.
 *
 * The flow is stored as a JSON string in `Bot.flow` and passed to this module
 * via `config._flow` by the framework dispatcher.
 *
 * Pause/Resume model
 * ──────────────────
 * When the flow reaches an INPUT or WAIT_CHOICE node, the engine returns
 * `paused: true` with the node id. We persist `{ pausedAt: nodeId, variables }`
 * to ConversationSession. On the user's next message we detect the paused
 * session, treat the new message as the awaited reply, and resume execution
 * from the node *after* the input node.
 *
 * For WAIT_CHOICE, we validate the reply against the options; if it doesn't
 * match, we re-prompt and stay paused.
 */
import type { BotModule, BotContext } from '../framework'
import { executeBotFlow, type BotFlow, type FlowNode, type ResumeDescriptor } from '../flow-types'

interface VisualSessionState {
  pausedAt: string | null
  variables: Record<string, string>
  /** When set, the bot is waiting for a choice reply. Stores the valid options. */
  awaitingChoice?: string[]
  awaitingVariable?: string
}

const EMPTY_STATE: VisualSessionState = { pausedAt: null, variables: {} }

function findNode(flow: BotFlow, id: string): FlowNode | undefined {
  return flow.nodes.find((n) => n.id === id)
}

export const visualBot: BotModule = {
  name: 'visual',
  description: 'Executes a visual flow-chart bot definition.',
  commands: [],
  onMessage: async (ctx: BotContext) => {
    // ── Load the flow ──────────────────────────────────────────────────
    const flowData = (ctx.bot.config as any)?._flow
    if (!flowData) return

    let flow: BotFlow
    try {
      flow = typeof flowData === 'string' ? JSON.parse(flowData) : flowData
    } catch {
      console.error('[visual bot] failed to parse flow')
      return
    }
    if (!flow.nodes?.length) return

    // ── Load or init session state ─────────────────────────────────────
    const state: VisualSessionState = { ...EMPTY_STATE, ...(await ctx.getState()) }
    if (!state.variables) state.variables = {}

    console.log(`[visual bot] onMessage: pausedAt=${state.pausedAt || 'null'}, body="${ctx.message.body}"`)

    // ── Resume case: paused session ────────────────────────────────────
    if (state.pausedAt) {
      const inputNode = findNode(flow, state.pausedAt)
      if (!inputNode) {
        console.log(`[visual bot] paused node not found, resetting`)
        // Stale session — reset and run from trigger
        await ctx.setState(EMPTY_STATE)
        await runFromTrigger(flow, ctx)
        return
      }

      console.log(`[visual bot] resuming at node type=${inputNode.type}`)

      const variableName = inputNode.data.variableName || 'reply'

      // WAIT_CHOICE: validate the user's reply against the options
      if (inputNode.type === 'wait_choice') {
        const options = inputNode.data.options || []
        const reply = ctx.message.body.trim()
        console.log(`[visual bot] wait_choice: reply="${reply}", options=${JSON.stringify(options)}`)

        // Allow "1", "2" indexing or direct match
        let matched: string | undefined
        const asNum = parseInt(reply, 10)
        if (!isNaN(asNum) && asNum >= 1 && asNum <= options.length) {
          matched = options[asNum - 1]
        } else {
          const lower = reply.toLowerCase()
          matched = options.find((o) => o.toLowerCase() === lower)
        }

        console.log(`[visual bot] matched=${matched || 'NONE'}`)

        if (!matched) {
          // Re-prompt with inline buttons and stay paused
          const prompt = inputNode.data.prompt || 'Pick one:'
          const keyboard = options.map((opt) => [{ text: opt, callbackData: opt }])
          await ctx.reply(prompt, keyboard)
          await ctx.setState({ ...state })
          return
        }

        // Valid choice — assign and resume from the next node
        state.variables[variableName] = matched
        const resume: ResumeDescriptor = {
          nodeId: inputNode.id,
          inputText: matched,
          inputVariable: variableName,
        }
        const result = await executeBotFlow(flow, {
          channelId: ctx.channelId,
          senderId: ctx.senderId,
          senderName: ctx.senderName,
          messageId: ctx.message.id,
          body: ctx.message.body,
          args: ctx.args,
          command: ctx.command,
          isMention: ctx.isMention,
          variables: state.variables,
          reply: ctx.reply,
          replyWithMedia: ctx.replyWithMedia,
          editMessage: ctx.editMessage,
        }, resume)

        await persistSession(ctx, result)
        return
      }

      // INPUT: treat the message as the reply and resume
      state.variables[variableName] = ctx.message.body
      const resume: ResumeDescriptor = {
        nodeId: inputNode.id,
        inputText: ctx.message.body,
        inputVariable: variableName,
      }
      const result = await executeBotFlow(flow, {
        channelId: ctx.channelId,
        senderId: ctx.senderId,
        senderName: ctx.senderName,
        messageId: ctx.message.id,
        body: ctx.message.body,
        args: ctx.args,
        command: ctx.command,
        isMention: ctx.isMention,
        variables: state.variables,
        reply: ctx.reply,
        replyWithMedia: ctx.replyWithMedia,
        editMessage: ctx.editMessage,
      }, resume)

      await persistSession(ctx, result)
      return
    }

    // ── Fresh start: run from trigger ──────────────────────────────────
    console.log(`[visual bot] no paused session — running from trigger`)
    await runFromTrigger(flow, ctx)
  },
}

async function runFromTrigger(flow: BotFlow, ctx: BotContext) {
  const state: VisualSessionState = { ...EMPTY_STATE, ...(await ctx.getState()) }
  if (!state.variables) state.variables = {}

  const result = await executeBotFlow(flow, {
    channelId: ctx.channelId,
    senderId: ctx.senderId,
    senderName: ctx.senderName,
    messageId: ctx.message.id,
    body: ctx.message.body,
    args: ctx.args,
    command: ctx.command,
    isMention: ctx.isMention,
    variables: state.variables,
    reply: ctx.reply,
    replyWithMedia: ctx.replyWithMedia,
    editMessage: ctx.editMessage,
  })

  await persistSession(ctx, result)
}

async function persistSession(ctx: BotContext, result: {
  paused: boolean
  pausedAtNodeId?: string
  variables: Record<string, string>
}) {
  if (result.paused && result.pausedAtNodeId) {
    // Look up the node to extract choice info if applicable
    await ctx.setState({
      pausedAt: result.pausedAtNodeId,
      variables: result.variables,
    })
  } else {
    // Flow completed (or errored) — clear any prior paused state
    await ctx.setState({ pausedAt: null, variables: {} })
  }
}
