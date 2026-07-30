/**
 * Visual Bot Builder — Types & Execution Engine (v2)
 *
 * Architecture
 * ────────────
 * A bot flow is a directed graph stored as JSON in `Bot.flow`:
 *   { nodes: FlowNode[], edges: FlowEdge[] }
 *
 * The engine walks the graph starting from a TRIGGER node. Crucially, it
 * supports **pause/resume** for INPUT and CHOICE nodes — when the engine
 * reaches one, it stops, persists `{ currentNodeId, variables }` to
 * ConversationSession, and resumes on the user's next message.
 *
 * Node categories (used by the UI for palette grouping):
 *   - trigger  : starts the flow (1 type, multiple subtypes)
 *   - output   : bot sends something (message, choice, typing)
 *   - input    : wait for user reply (text input, choice input)
 *   - logic    : control flow (condition, set_var, delay, stop)
 *   - advanced : power features (api_call, random)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Node type catalog
// ─────────────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'trigger'
  | 'message'
  | 'typing'
  | 'input'
  | 'wait_choice'
  | 'condition'
  | 'switch_case'
  | 'set_var'
  | 'counter'
  | 'format_string'
  | 'delay'
  | 'stop'
  | 'api_call'
  | 'random'
  | 'ai_generate'
  | 'send_media'
  | 'log'

export type NodeCategory = 'trigger' | 'output' | 'input' | 'logic' | 'advanced'

// ─────────────────────────────────────────────────────────────────────────────
// Flow shape (persisted as JSON in Bot.flow)
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: FlowNodeData
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  label?: string
}

export interface BotFlow {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowNodeData {
  // ── trigger ──
  triggerType?: 'any_message' | 'command' | 'mention'
  command?: string // without leading slash

  // ── message ──
  text?: string

  // ── wait_choice ──
  prompt?: string
  options?: string[] // quick-reply choices
  variableName?: string // where to store the reply

  // ── typing ──
  seconds?: number

  // ── input ──
  // (uses prompt + variableName from above)

  // ── condition ──
  variable?: string
  operator?: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'exists' | 'not_exists'
  value?: string

  // ── set_var ──
  // (uses variable + value from above)

  // ── api_call ──
  url?: string
  method?: 'GET' | 'POST'
  headers?: string // JSON string
  body?: string
  // (also uses variableName to store response)

  // ── random ──
  // (no data — uses N outgoing edges; engine picks one)

  // ── ai_generate ──
  /** The prompt to send to the LLM. Supports {{var}} interpolation. */
  aiPrompt?: string
  /** Optional system prompt to set the LLM's persona/behavior. */
  aiSystemPrompt?: string
  /** Ollama model name, e.g. 'gemma3:270m'. */
  aiModel?: string
  /** Sampling temperature (0 = deterministic, 1 = creative). */
  aiTemperature?: number
  /** Max tokens to generate. */
  aiMaxTokens?: number
  // (also uses variableName to store the generated response)

  // ── switch_case ──
  /** Variable to switch on. */
  switchVariable?: string
  /** Case values — each gets its own outgoing handle (case_0, case_1, ...). */
  cases?: string[]
  // (uses 'default' handle for unmatched values)

  // ── counter ──
  // (uses `variable` to hold the counter name)
  /** Amount to increment by (negative = decrement). */
  increment?: number
  /** Starting value when the variable doesn't exist yet. */
  startValue?: number

  // ── format_string ──
  // (uses `text` as the template with {{var}} placeholders)
  // (uses `variableName` to store the result)

  // ── send_media ──
  /** URL of the media to send (image/video/audio). */
  mediaUrl?: string
  /** Caption text. Supports {{var}} interpolation. */
  caption?: string
  /** Media type: image, video, audio. */
  mediaType?: 'image' | 'video' | 'audio'

  // ── log ──
  /** Message to log. Supports {{var}} interpolation. */
  logMessage?: string
  /** Log level. */
  logLevel?: 'info' | 'warn' | 'error'

  // ── UI metadata (not used by engine) ──
  /** Node type — stored in data so the editor's CustomNode can read it.
   *  Duplicates FlowNode.type but is required because ReactFlow sets
   *  n.type to 'custom' for all custom nodes. */
  type?: NodeType
  label?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution context & result
// ─────────────────────────────────────────────────────────────────────────────

/** A single inline keyboard button (Telegram-style). */
export interface BotKeyboardButton {
  text: string
  /** Value sent back to the bot when the button is clicked. */
  callbackData: string
}

export interface BotExecutionContext {
  channelId: string
  senderId: string
  senderName: string
  messageId: string
  body: string
  args: string[]
  command?: string
  isMention: boolean

  /**
   * Variables for the current execution. The caller (visual.ts) is responsible
   * for loading these from ConversationSession at the start and persisting
   * them when execution pauses.
   */
  variables: Record<string, string>

  /** Helpers — visual.ts wires these to ConversationSession. */
  getState?: () => Promise<any>
  setState?: (state: any) => Promise<void>

  /** Reply helper — pushes a message as the bot. Optional keyboard attaches
   *  Telegram-style inline buttons to the message. */
  reply: (text: string, keyboard?: BotKeyboardButton[][]) => Promise<void>

  /** Show typing indicator — best-effort, no-op if unsupported. */
  setTyping?: (seconds: number) => Promise<void>
}

export interface BotExecutionResult {
  /** Messages emitted by the run (already sent via ctx.reply by the engine). */
  sentCount: number

  /** True if the flow paused at an input node, waiting for the next message. */
  paused: boolean

  /** When paused, the id of the input node we're waiting at. */
  pausedAtNodeId?: string

  /** Final variable state (caller persists this). */
  variables: Record<string, string>

  /** Execution trace — ordered list of events for debugging. */
  trace?: TraceEvent[]

  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution trace — emitted by the engine for debugging/test-runs
// ─────────────────────────────────────────────────────────────────────────────

export type TraceEvent =
  | { type: 'flow_start'; timestamp: number; triggerNodeId?: string; input: { body: string; sender: string; command?: string } }
  | { type: 'node_enter'; timestamp: number; nodeId: string; nodeType: NodeType; nodeLabel: string }
  | { type: 'node_exit'; timestamp: number; nodeId: string; durationMs: number }
  | { type: 'message_sent'; timestamp: number; nodeId: string; text: string }
  | { type: 'variable_set'; timestamp: number; nodeId: string; variable: string; value: string }
  | { type: 'condition_eval'; timestamp: number; nodeId: string; variable: string; value: string; operator: string; compareTo: string; result: boolean }
  | { type: 'branch_taken'; timestamp: number; nodeId: string; handle: string; targetNodeId: string }
  | { type: 'ai_call'; timestamp: number; nodeId: string; model: string; prompt: string; responseLength: number; durationMs: number }
  | { type: 'api_call'; timestamp: number; nodeId: string; url: string; method: string; status: number; durationMs: number }
  | { type: 'paused'; timestamp: number; nodeId: string; variableName: string }
  | { type: 'resumed'; timestamp: number; nodeId: string; inputText: string }
  | { type: 'error'; timestamp: number; nodeId?: string; message: string }
  | { type: 'flow_end'; timestamp: number; reason: 'stop' | 'no_edge' | 'max_steps' | 'error'; sentCount: number }
  | { type: 'log'; timestamp: number; nodeId: string; level: 'info' | 'warn' | 'error'; message: string }

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

const MAX_STEPS = 50

/**
 * Resume descriptor — when set, the engine resumes from `nodeId` instead of
 * searching for a trigger. The caller passes this when a paused session
 * receives its awaited reply.
 */
export interface ResumeDescriptor {
  nodeId: string
  /** The text to assign to the input variable (usually the user's reply). */
  inputText: string
  /** The variable name to assign inputText to. */
  inputVariable: string
}

/**
 * Replace {{var}} placeholders in a string.
 */
function interpolate(text: string, ctx: BotExecutionContext): string {
  let out = text
  for (const [k, v] of Object.entries(ctx.variables)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
  }
  out = out.replace(/\{\{sender\}\}/g, ctx.senderName)
  out = out.replace(/\{\{args\}\}/g, ctx.args.join(' '))
  out = out.replace(/\{\{body\}\}/g, ctx.body)
  return out
}

/**
 * Execute a bot flow. Returns when:
 *   - the flow reaches a `stop` node,
 *   - the flow ends naturally (no outgoing edge),
 *   - the flow pauses at an INPUT/WAIT_CHOICE node,
 *   - MAX_STEPS is exceeded.
 *
 * Emits trace events for debugging — each node entry/exit, variable change,
 * message sent, condition evaluation, branch taken, and error is recorded.
 * The caller can pass these to the UI for a test-run visualization.
 */
export async function executeBotFlow(
  flow: BotFlow,
  ctx: BotExecutionContext,
  resume?: ResumeDescriptor
): Promise<BotExecutionResult> {
  let sentCount = 0
  let steps = 0
  let currentNode: FlowNode | undefined
  const trace: TraceEvent[] = []
  const now = () => Date.now()

  // ── Helpers (declared early so the resume block can use them) ─────────
  const edgesFrom = (nodeId: string, handle?: string | null) =>
    flow.edges.filter((e) => {
      if (e.source !== nodeId) return false
      if (handle === undefined) return true
      if (handle === null) return !e.sourceHandle
      return e.sourceHandle === handle
    })

  const followEdge = (nodeId: string, handle?: string | null): FlowNode | undefined => {
    const edges = edgesFrom(nodeId, handle)
    if (edges.length === 0) return undefined
    return flow.nodes.find((n) => n.id === edges[0].target)
  }

  // ── Resolve starting node ─────────────────────────────────────────────
  if (resume) {
    const inputNode = flow.nodes.find((n) => n.id === resume.nodeId)
    if (!inputNode) {
      trace.push({ type: 'error', timestamp: now(), message: 'resume target not found' })
      return { sentCount: 0, paused: false, variables: ctx.variables, trace, error: 'resume target not found' }
    }
    ctx.variables[resume.inputVariable] = resume.inputText
    trace.push({ type: 'resumed', timestamp: now(), nodeId: inputNode.id, inputText: resume.inputText })
    trace.push({ type: 'variable_set', timestamp: now(), nodeId: inputNode.id, variable: resume.inputVariable, value: resume.inputText })
    currentNode = followEdge(inputNode.id, null)
    if (!currentNode) {
      trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
      return { sentCount, paused: false, variables: ctx.variables, trace }
    }
  } else {
    const trigger = flow.nodes.find((n) => n.type === 'trigger')
    if (!trigger) {
      trace.push({ type: 'error', timestamp: now(), message: 'No trigger node found' })
      return { sentCount: 0, paused: false, variables: ctx.variables, trace, error: 'No trigger node found' }
    }

    trace.push({
      type: 'flow_start',
      timestamp: now(),
      triggerNodeId: trigger.id,
      input: { body: ctx.body, sender: ctx.senderName, command: ctx.command },
    })

    // Trigger matching
    const tt = trigger.data.triggerType || 'any_message'
    if (tt === 'command' && trigger.data.command) {
      if (!ctx.command || ctx.command !== trigger.data.command.replace(/^\//, '')) {
        trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
        return { sentCount: 0, paused: false, variables: ctx.variables, trace }
      }
    } else if (tt === 'mention') {
      if (!ctx.isMention) {
        trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
        return { sentCount: 0, paused: false, variables: ctx.variables, trace }
      }
    }

    currentNode = trigger
  }

  // ── Walk the graph ────────────────────────────────────────────────────
  while (currentNode && steps < MAX_STEPS) {
    steps++
    const nodeStartTime = now()
    const nodeLabel = currentNode.data?.label || currentNode.type

    trace.push({
      type: 'node_enter',
      timestamp: nodeStartTime,
      nodeId: currentNode.id,
      nodeType: currentNode.type,
      nodeLabel,
    })

    switch (currentNode.type) {
      // ── TRIGGER ────────────────────────────────────────────────────────
      case 'trigger':
        currentNode = followEdge(currentNode.id, null)
        break

      // ── OUTPUT: message ────────────────────────────────────────────────
      case 'message': {
        const text = interpolate(currentNode.data.text || '', ctx)
        if (text.trim()) {
          await ctx.reply(text)
          sentCount++
          trace.push({ type: 'message_sent', timestamp: now(), nodeId: currentNode.id, text })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── OUTPUT: send_media ─────────────────────────────────────────────
      case 'send_media': {
        const url = interpolate(currentNode.data.mediaUrl || '', ctx)
        const caption = interpolate(currentNode.data.caption || '', ctx)
        if (url.trim()) {
          // ctx.reply is text-only; we log it but the actual media send
          // would need an extended reply API. For now, send the URL as text.
          const text = caption ? `${caption}\n${url}` : url
          await ctx.reply(text)
          sentCount++
          trace.push({ type: 'message_sent', timestamp: now(), nodeId: currentNode.id, text })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── OUTPUT: typing ─────────────────────────────────────────────────
      case 'typing': {
        const seconds = currentNode.data.seconds || 1
        if (ctx.setTyping) await ctx.setTyping(seconds)
        else await new Promise((r) => setTimeout(r, Math.min(seconds, 2) * 1000))
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── INPUT: pause and wait for next message ────────────────────────
      case 'input': {
        const prompt = interpolate(currentNode.data.prompt || '', ctx)
        if (prompt.trim()) {
          await ctx.reply(prompt)
          sentCount++
          trace.push({ type: 'message_sent', timestamp: now(), nodeId: currentNode.id, text: prompt })
        }
        trace.push({ type: 'paused', timestamp: now(), nodeId: currentNode.id, variableName: currentNode.data.variableName || 'reply' })
        trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
        return {
          sentCount,
          paused: true,
          pausedAtNodeId: currentNode.id,
          variables: ctx.variables,
          trace,
        }
      }

      // ── INPUT: wait_choice ────────────────────────────────────────────
      case 'wait_choice': {
        const prompt = interpolate(currentNode.data.prompt || '', ctx)
        const options = currentNode.data.options || []
        // Build a Telegram-style inline keyboard — each option is a button.
        // The button's callbackData is the option text itself, so the resume
        // path in visual.ts can match it directly.
        const keyboard: BotKeyboardButton[][] = options.map((opt) => [{
          text: opt,
          callbackData: opt,
        }])
        if (prompt.trim()) {
          await ctx.reply(prompt, keyboard)
          sentCount++
          trace.push({ type: 'message_sent', timestamp: now(), nodeId: currentNode.id, text: prompt })
        }
        trace.push({ type: 'paused', timestamp: now(), nodeId: currentNode.id, variableName: currentNode.data.variableName || 'choice' })
        trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
        return {
          sentCount,
          paused: true,
          pausedAtNodeId: currentNode.id,
          variables: ctx.variables,
          trace,
        }
      }

      // ── LOGIC: condition ──────────────────────────────────────────────
      case 'condition': {
        const varName = currentNode.data.variable || ''
        const varValue = ctx.variables[varName] || ''
        const op = currentNode.data.operator || 'exists'
        const cmp = currentNode.data.value || ''

        let met = false
        switch (op) {
          case 'equals':       met = varValue === cmp; break
          case 'not_equals':   met = varValue !== cmp; break
          case 'contains':     met = varValue.includes(cmp); break
          case 'starts_with':  met = varValue.startsWith(cmp); break
          case 'exists':       met = !!varValue; break
          case 'not_exists':   met = !varValue; break
        }

        trace.push({
          type: 'condition_eval',
          timestamp: now(),
          nodeId: currentNode.id,
          variable: varName,
          value: varValue,
          operator: op,
          compareTo: cmp,
          result: met,
        })

        const handle = met ? 'true' : 'false'
        const next = followEdge(currentNode.id, handle)
        if (next) {
          trace.push({ type: 'branch_taken', timestamp: now(), nodeId: currentNode.id, handle, targetNodeId: next.id })
          currentNode = next
        } else {
          // No matching branch — fall through to default edge if any
          const fallback = followEdge(currentNode.id, null)
          if (fallback) {
            trace.push({ type: 'branch_taken', timestamp: now(), nodeId: currentNode.id, handle: 'default', targetNodeId: fallback.id })
            currentNode = fallback
          } else {
            trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
            currentNode = undefined
          }
        }
        break
      }

      // ── LOGIC: switch_case (multi-branch) ─────────────────────────────
      case 'switch_case': {
        const varName = currentNode.data.switchVariable || ''
        const varValue = ctx.variables[varName] || ''
        const cases = currentNode.data.cases || []

        const matchIdx = cases.findIndex((c) => c === varValue)
        const handle = matchIdx >= 0 ? `case_${matchIdx}` : 'default'

        trace.push({
          type: 'condition_eval',
          timestamp: now(),
          nodeId: currentNode.id,
          variable: varName,
          value: varValue,
          operator: 'switch',
          compareTo: matchIdx >= 0 ? cases[matchIdx] : '(default)',
          result: matchIdx >= 0,
        })

        const next = followEdge(currentNode.id, handle)
        if (next) {
          trace.push({ type: 'branch_taken', timestamp: now(), nodeId: currentNode.id, handle, targetNodeId: next.id })
          currentNode = next
        } else {
          const fallback = followEdge(currentNode.id, null)
          if (fallback) {
            trace.push({ type: 'branch_taken', timestamp: now(), nodeId: currentNode.id, handle: 'default', targetNodeId: fallback.id })
            currentNode = fallback
          } else {
            trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
            currentNode = undefined
          }
        }
        break
      }

      // ── LOGIC: set_var ────────────────────────────────────────────────
      case 'set_var': {
        const name = currentNode.data.variable || ''
        const val = interpolate(currentNode.data.value || '', ctx)
        if (name) {
          ctx.variables[name] = val
          trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: name, value: val })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── LOGIC: counter (increment/decrement a numeric variable) ───────
      case 'counter': {
        const name = currentNode.data.variable || ''
        const inc = currentNode.data.increment ?? 1
        const startVal = currentNode.data.startValue ?? 0
        const current = parseInt(ctx.variables[name] || '', 10)
        const newVal = isNaN(current) ? startVal + inc : current + inc
        ctx.variables[name] = String(newVal)
        trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: name, value: String(newVal) })
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── LOGIC: format_string (template a string with variables) ──────
      case 'format_string': {
        const template = currentNode.data.text || ''
        const result = interpolate(template, ctx)
        const vname = currentNode.data.variableName
        if (vname) {
          ctx.variables[vname] = result
          trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: result })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── LOGIC: delay ──────────────────────────────────────────────────
      case 'delay': {
        const s = Math.max(0, Math.min(60, currentNode.data.seconds || 1))
        await new Promise((r) => setTimeout(r, s * 1000))
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── LOGIC: log (debug logging — shows in trace, no user output) ───
      case 'log': {
        const msg = interpolate(currentNode.data.logMessage || '', ctx)
        const level = currentNode.data.logLevel || 'info'
        trace.push({ type: 'log', timestamp: now(), nodeId: currentNode.id, level, message: msg })
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── LOGIC: stop ───────────────────────────────────────────────────
      case 'stop':
        trace.push({ type: 'flow_end', timestamp: now(), reason: 'stop', sentCount })
        return { sentCount, paused: false, variables: ctx.variables, trace }

      // ── ADVANCED: api_call ────────────────────────────────────────────
      case 'api_call': {
        const callStart = now()
        try {
          const url = interpolate(currentNode.data.url || '', ctx)
          const method = currentNode.data.method || 'GET'
          const headers = currentNode.data.headers ? JSON.parse(currentNode.data.headers) : {}
          const body = currentNode.data.body ? interpolate(currentNode.data.body, ctx) : undefined
          const res = await fetch(url, { method, headers, body })
          const text = await res.text()
          const vname = currentNode.data.variableName
          if (vname) {
            ctx.variables[vname] = text.slice(0, 4000)
            trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: text.slice(0, 200) + (text.length > 200 ? '…' : '') })
          }
          trace.push({ type: 'api_call', timestamp: now(), nodeId: currentNode.id, url, method, status: res.status, durationMs: now() - callStart })
        } catch (e: any) {
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: `API call failed: ${e?.message || e}` })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── ADVANCED: random ──────────────────────────────────────────────
      case 'random': {
        const allEdges = edgesFrom(currentNode.id, undefined)
        if (allEdges.length === 0) {
          trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
          currentNode = undefined
          break
        }
        const pick = allEdges[Math.floor(Math.random() * allEdges.length)]
        const target = flow.nodes.find((n) => n.id === pick.target)
        if (target) {
          trace.push({ type: 'branch_taken', timestamp: now(), nodeId: currentNode.id, handle: pick.sourceHandle || 'random', targetNodeId: target.id })
          currentNode = target
        } else {
          currentNode = undefined
        }
        break
      }

      // ── ADVANCED: ai_generate ──────────────────────────────────────────
      case 'ai_generate': {
        const vname = currentNode.data.variableName || 'aiResponse'
        const callStart = now()
        try {
          const model = currentNode.data.aiModel || 'gemma3:270m'
          const prompt = interpolate(currentNode.data.aiPrompt || '', ctx)
          const systemPrompt = currentNode.data.aiSystemPrompt
            ? interpolate(currentNode.data.aiSystemPrompt, ctx)
            : undefined
          const temperature = currentNode.data.aiTemperature ?? 0.7
          const maxTokens = currentNode.data.aiMaxTokens ?? 256

          const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
          const res = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model, prompt, system: systemPrompt, stream: false,
              options: { temperature, num_predict: maxTokens },
            }),
          })

          if (!res.ok) {
            const errText = await res.text().catch(() => 'unknown error')
            const errMsg = `Ollama error ${res.status}: ${errText.slice(0, 100)}`
            ctx.variables[vname] = `[AI error: ${res.status}]`
            trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: errMsg })
            trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: ctx.variables[vname] })
            trace.push({ type: 'ai_call', timestamp: now(), nodeId: currentNode.id, model, prompt: prompt.slice(0, 100), responseLength: 0, durationMs: now() - callStart })
          } else {
            const data = await res.json()
            const generated: string = data.response || ''
            ctx.variables[vname] = generated.slice(0, 4000)
            trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: generated.slice(0, 200) + (generated.length > 200 ? '…' : '') })
            trace.push({ type: 'ai_call', timestamp: now(), nodeId: currentNode.id, model, prompt: prompt.slice(0, 100), responseLength: generated.length, durationMs: now() - callStart })
          }
        } catch (e: any) {
          ctx.variables[vname] = `[AI error: ${e?.message || 'unavailable'}]`
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: `AI generate failed: ${e?.message || e}` })
          trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: ctx.variables[vname] })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      default:
        trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: `unknown node type: ${currentNode.type}` })
        return { sentCount, paused: false, variables: ctx.variables, trace, error: `unknown node type: ${currentNode.type}` }
    }

    // Record node exit
    if (currentNode) {
      trace.push({ type: 'node_exit', timestamp: now(), nodeId: currentNode.id, durationMs: 0 })
    }
  }

  if (steps >= MAX_STEPS) {
    await ctx.reply('⚠️ Bot flow exceeded maximum steps (possible infinite loop).')
    trace.push({ type: 'error', timestamp: now(), message: 'max steps exceeded' })
    trace.push({ type: 'flow_end', timestamp: now(), reason: 'max_steps', sentCount })
    return { sentCount, paused: false, variables: ctx.variables, trace, error: 'max steps' }
  }

  trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
  return { sentCount, paused: false, variables: ctx.variables, trace }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI metadata — node catalog (used by the editor for palette + rendering)
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeDef {
  type: NodeType
  label: string
  category: NodeCategory
  description: string
  /** Lucide icon name (string — editor maps it to the component). */
  icon: string
  /** Hex color, used for accents, borders, handles. */
  color: string
  /** Background tint, hex with alpha. */
  bg: string
  /** Handle layout: 'single' | 'true_false' | 'multi' */
  handles: 'single' | 'true_false' | 'multi'
  /** Whether this node can be the starting point of the flow. */
  isStart?: boolean
  /** Whether this node pauses execution and waits for the next message. */
  pauses?: boolean
  /** Whether this node terminates the flow. */
  terminates?: boolean
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  trigger: {
    type: 'trigger', label: 'Trigger', category: 'trigger',
    description: 'Starts the bot when a message, command, or mention arrives',
    icon: 'Zap', color: '#A78BFA', bg: '#A78BFA1A',
    handles: 'single', isStart: true,
  },
  message: {
    type: 'message', label: 'Send Message', category: 'output',
    description: 'Sends a text message to the channel',
    icon: 'Send', color: '#34D399', bg: '#34D3991A',
    handles: 'single',
  },
  send_media: {
    type: 'send_media', label: 'Send Media', category: 'output',
    description: 'Sends an image, video, or audio file',
    icon: 'Image', color: '#4ADE80', bg: '#4ADE801A',
    handles: 'single',
  },
  typing: {
    type: 'typing', label: 'Typing Pause', category: 'output',
    description: 'Shows a typing indicator for a moment',
    icon: 'Loader', color: '#6EE7B7', bg: '#6EE7B71A',
    handles: 'single',
  },
  input: {
    type: 'input', label: 'Wait for Reply', category: 'input',
    description: 'Asks a question and waits for the next message',
    icon: 'Keyboard', color: '#F87171', bg: '#F871711A',
    handles: 'single', pauses: true,
  },
  wait_choice: {
    type: 'wait_choice', label: 'Wait for Choice', category: 'input',
    description: 'Waits for the user to pick one of N options',
    icon: 'MousePointerClick', color: '#FB923C', bg: '#FB923C1A',
    handles: 'single', pauses: true,
  },
  condition: {
    type: 'condition', label: 'Condition', category: 'logic',
    description: 'Branches based on a variable comparison (true/false)',
    icon: 'GitBranch', color: '#FBBF24', bg: '#FBBF241A',
    handles: 'true_false',
  },
  switch_case: {
    type: 'switch_case', label: 'Switch', category: 'logic',
    description: 'Multi-branch based on exact variable value match',
    icon: 'Split', color: '#FB7185', bg: '#FB71851A',
    handles: 'multi',
  },
  set_var: {
    type: 'set_var', label: 'Set Variable', category: 'logic',
    description: 'Sets a variable to a value',
    icon: 'Variable', color: '#FCD34D', bg: '#FCD34D1A',
    handles: 'single',
  },
  counter: {
    type: 'counter', label: 'Counter', category: 'logic',
    description: 'Increments or decrements a numeric variable',
    icon: 'Hash', color: '#FACC15', bg: '#FACC151A',
    handles: 'single',
  },
  format_string: {
    type: 'format_string', label: 'Format String', category: 'logic',
    description: 'Builds a string from a template with {{variables}}',
    icon: 'Braces', color: '#E0E7FF', bg: '#E0E7FF1A',
    handles: 'single',
  },
  delay: {
    type: 'delay', label: 'Delay', category: 'logic',
    description: 'Waits for N seconds before continuing',
    icon: 'Clock', color: '#F59E0B', bg: '#F59E0B1A',
    handles: 'single',
  },
  log: {
    type: 'log', label: 'Log', category: 'logic',
    description: 'Debug log — shows in the trace panel, no user output',
    icon: 'Terminal', color: '#94A3B8', bg: '#94A3B81A',
    handles: 'single',
  },
  stop: {
    type: 'stop', label: 'Stop', category: 'logic',
    description: 'Ends the flow immediately',
    icon: 'Square', color: '#EF4444', bg: '#EF44441A',
    handles: 'single', terminates: true,
  },
  api_call: {
    type: 'api_call', label: 'API Call', category: 'advanced',
    description: 'Calls an external HTTP endpoint',
    icon: 'Webhook', color: '#22D3EE', bg: '#22D3EE1A',
    handles: 'single',
  },
  random: {
    type: 'random', label: 'Random Branch', category: 'advanced',
    description: 'Picks one outgoing edge at random',
    icon: 'Shuffle', color: '#2DD4BF', bg: '#2DD4BF1A',
    handles: 'multi',
  },
  ai_generate: {
    type: 'ai_generate', label: 'AI Generate', category: 'advanced',
    description: 'Generates text with a local Ollama LLM',
    icon: 'Sparkles', color: '#C084FC', bg: '#C084FC1A',
    handles: 'single',
  },
}

export const CATEGORY_ORDER: NodeCategory[] = ['trigger', 'output', 'input', 'logic', 'advanced']

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: 'Triggers',
  output: 'Output',
  input: 'Input',
  logic: 'Logic',
  advanced: 'Advanced',
}

/** Default data factory — gives every new node a sensible starting state. */
export function defaultNodeData(type: NodeType): FlowNodeData {
  switch (type) {
    case 'trigger':
      return { triggerType: 'any_message', label: 'Trigger' }
    case 'message':
      return { text: 'Hello {{sender}}!', label: 'Send Message' }
    case 'send_media':
      return { mediaUrl: '', caption: '', mediaType: 'image', label: 'Send Media' }
    case 'typing':
      return { seconds: 2, label: 'Typing Pause' }
    case 'input':
      return { prompt: 'What is your name?', variableName: 'userName', label: 'Wait for Reply' }
    case 'wait_choice':
      return { prompt: 'Pick one:', options: ['Yes', 'No'], variableName: 'choice', label: 'Wait for Choice' }
    case 'condition':
      return { variable: '', operator: 'exists', value: '', label: 'Condition' }
    case 'switch_case':
      return { switchVariable: '', cases: ['yes', 'no'], label: 'Switch' }
    case 'set_var':
      return { variable: '', value: '', label: 'Set Variable' }
    case 'counter':
      return { variable: 'count', increment: 1, startValue: 0, label: 'Counter' }
    case 'format_string':
      return { text: 'Hello {{name}}!', variableName: 'formatted', label: 'Format String' }
    case 'delay':
      return { seconds: 1, label: 'Delay' }
    case 'log':
      return { logMessage: 'Debug: {{body}}', logLevel: 'info', label: 'Log' }
    case 'stop':
      return { label: 'Stop' }
    case 'api_call':
      return { url: '', method: 'GET', variableName: 'apiResult', label: 'API Call' }
    case 'random':
      return { label: 'Random Branch' }
    case 'ai_generate':
      return {
        label: 'AI Generate',
        aiPrompt: 'Summarize this message in one sentence: {{body}}',
        aiSystemPrompt: '',
        aiModel: 'gemma3:270m',
        aiTemperature: 0.7,
        aiMaxTokens: 256,
        variableName: 'aiResponse',
      }
  }
}
