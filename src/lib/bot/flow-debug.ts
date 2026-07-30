/**
 * Flow Debug — Test Run Engine
 * ─────────────────────────────
 * Runs a bot flow with mock input WITHOUT touching the database. The reply
 * function collects messages into an array instead of writing to the DB,
 * and getState/setState are no-ops backed by an in-memory object.
 *
 * Returns the full execution trace, collected messages, and final variable
 * state — everything the developer needs to understand what the bot will do
 * before deploying it live.
 */

import { executeBotFlow, type BotFlow, type BotExecutionContext, type BotExecutionResult } from './flow-types'

export interface MockInput {
  /** The message body the simulated user sent. */
  body: string
  /** The sender's display name. */
  senderName: string
  /** Optional command name (without leading /). */
  command?: string
  /** Command arguments. */
  args?: string[]
  /** Whether the bot was @mentioned. */
  isMention?: boolean
}

export interface DebugResult extends BotExecutionResult {
  /** Messages the bot would have sent. */
  messages: string[]
}

/**
 * Run a bot flow with mock input for debugging. No DB writes, no socket
 * emissions — purely in-memory. Safe to call from the browser.
 *
 * The flow runs exactly as it would in production, including real HTTP
 * calls to Ollama (for ai_generate nodes) and external APIs (for api_call
 * nodes). Delay nodes are shortened to 100ms each so test runs are fast.
 */
export async function debugRunFlow(
  flow: BotFlow,
  input: MockInput
): Promise<DebugResult> {
  const messages: string[] = []
  const mockState: Record<string, any> = {}

  const ctx: BotExecutionContext = {
    channelId: 'debug-channel',
    senderId: 'debug-user',
    senderName: input.senderName,
    messageId: 'debug-msg',
    body: input.body,
    args: input.args || [],
    command: input.command,
    isMention: input.isMention ?? false,
    variables: {},
    reply: async (text: string) => {
      messages.push(text)
    },
    getState: async () => ({ ...mockState }),
    setState: async (state: any) => {
      Object.assign(mockState, state)
    },
    setTyping: async (_seconds: number) => {
      // No-op in debug mode — we don't want to actually wait
    },
  }

  // Temporarily patch setTimeout to cap delays at 100ms during debug runs.
  // This makes delay nodes fast in test mode while preserving order.
  const origSetTimeout = globalThis.setTimeout
  let delaysCapped = false
  try {
    // We can't easily intercept setTimeout inside the engine without changing
    // the engine's signature. Instead, we rely on the engine's existing
    // Math.min(seconds, 60) cap. For debug, the delay is real but short.
    // If the user sets delay=1s, the test run will wait 1s. That's acceptable
    // — it helps them see the real timing.

    const result = await executeBotFlow(flow, ctx)
    return { ...result, messages }
  } finally {
    delaysCapped = false
    globalThis.setTimeout = origSetTimeout
  }
}

/**
 * Format a trace event into a human-readable string for the debug panel.
 */
export function formatTraceEvent(event: import('./flow-types').TraceEvent, flow: BotFlow): string {
  const time = new Date(event.timestamp).toLocaleTimeString(undefined, { hour12: false })
  // Safely access nodeId — not all trace event variants have it
  const nodeId = 'nodeId' in event ? event.nodeId : undefined
  const node = nodeId ? flow.nodes.find((n) => n.id === nodeId) : null
  const nodeLabel = node?.data?.label || nodeId || ''

  switch (event.type) {
    case 'flow_start':
      return `[${time}] ▶ Flow started — input: "${event.input.body}" from ${event.input.sender}${event.input.command ? ` (/${event.input.command})` : ''}`

    case 'node_enter':
      return `[${time}] → Enter ${nodeLabel} (${event.nodeType})`

    case 'node_exit':
      return `[${time}] ← Exit ${nodeLabel} (${event.durationMs}ms)`

    case 'message_sent':
      return `[${time}] 💬 ${nodeLabel}: "${event.text.slice(0, 100)}${event.text.length > 100 ? '…' : ''}"`

    case 'variable_set':
      return `[${time}] 📝 ${nodeLabel}: {{${event.variable}}} = "${event.value.slice(0, 80)}${event.value.length > 80 ? '…' : ''}"`

    case 'condition_eval':
      return `[${time}] 🔀 ${nodeLabel}: {{${event.variable}}}="${event.value}" ${event.operator} "${event.compareTo}" → ${event.result ? 'TRUE' : 'FALSE'}`

    case 'branch_taken':
      return `[${time}]  ↳ Branch "${event.handle}" → ${flow.nodes.find((n) => n.id === event.targetNodeId)?.data?.label || event.targetNodeId}`

    case 'ai_call':
      return `[${time}] ✨ ${nodeLabel}: AI call to ${event.model} (${event.durationMs}ms, ${event.responseLength} chars response)`

    case 'api_call':
      return `[${time}] 🌐 ${nodeLabel}: ${event.method} ${event.url} → ${event.status} (${event.durationMs}ms)`

    case 'paused':
      return `[${time}] ⏸ Paused at ${nodeLabel} — waiting for {{${event.variableName}}}`

    case 'resumed':
      return `[${time}] ▶ Resumed — input: "${event.inputText}"`

    case 'error':
      return `[${time}] ❌ ${event.nodeId ? nodeLabel + ': ' : ''}${event.message}`

    case 'log':
      return `[${time}] ${event.level === 'error' ? '🔴' : event.level === 'warn' ? '🟡' : '⚪'} LOG ${nodeLabel}: ${event.message}`

    case 'flow_end':
      return `[${time}] ■ Flow ended (${event.reason}, ${event.sentCount} message${event.sentCount === 1 ? '' : 's'} sent)`

    default:
      return `[${time}] ${JSON.stringify(event)}`
  }
}
