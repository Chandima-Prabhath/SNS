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
  | 'choice'
  | 'typing'
  | 'input'
  | 'wait_choice'
  | 'condition'
  | 'set_var'
  | 'delay'
  | 'stop'
  | 'api_call'
  | 'random'

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

  // ── choice / wait_choice ──
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

  // ── UI metadata (not used by engine) ──
  label?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution context & result
// ─────────────────────────────────────────────────────────────────────────────

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

  /** Reply helper — pushes a message as the bot. */
  reply: (text: string) => Promise<void>

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

  error?: string
}

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
 */
export async function executeBotFlow(
  flow: BotFlow,
  ctx: BotExecutionContext,
  resume?: ResumeDescriptor
): Promise<BotExecutionResult> {
  let sentCount = 0
  let steps = 0
  let currentNode: FlowNode | undefined

  // ── Resolve starting node ─────────────────────────────────────────────
  if (resume) {
    currentNode = flow.nodes.find((n) => n.id === resume.nodeId)
    if (!currentNode) {
      return { sentCount: 0, paused: false, variables: ctx.variables, error: 'resume target not found' }
    }
    // Assign the awaited reply to the variable BEFORE walking past the input node.
    ctx.variables[resume.inputVariable] = resume.inputText
  } else {
    const trigger = flow.nodes.find((n) => n.type === 'trigger')
    if (!trigger) {
      return { sentCount: 0, paused: false, variables: ctx.variables, error: 'No trigger node found' }
    }

    // Trigger matching
    const tt = trigger.data.triggerType || 'any_message'
    if (tt === 'command' && trigger.data.command) {
      if (!ctx.command || ctx.command !== trigger.data.command.replace(/^\//, '')) {
        return { sentCount: 0, paused: false, variables: ctx.variables }
      }
    } else if (tt === 'mention') {
      if (!ctx.isMention) {
        return { sentCount: 0, paused: false, variables: ctx.variables }
      }
    }
    // any_message: always proceeds

    currentNode = trigger
  }

  // ── Helpers ───────────────────────────────────────────────────────────
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

  // ── Walk the graph ────────────────────────────────────────────────────
  while (currentNode && steps < MAX_STEPS) {
    steps++

    switch (currentNode.type) {
      // ── TRIGGER ────────────────────────────────────────────────────────
      case 'trigger':
        // Just follow the next edge
        currentNode = followEdge(currentNode.id, null)
        continue

      // ── OUTPUT: message ────────────────────────────────────────────────
      case 'message': {
        const text = interpolate(currentNode.data.text || '', ctx)
        if (text.trim()) {
          await ctx.reply(text)
          sentCount++
        }
        currentNode = followEdge(currentNode.id, null)
        continue
      }

      // ── OUTPUT: choice ─────────────────────────────────────────────────
      case 'choice': {
        // Send the prompt with the options appended as inline buttons (visual
        // approximation). The next node is typically a `wait_choice` that
        // uses the same `variableName`.
        const prompt = interpolate(currentNode.data.prompt || '', ctx)
        const options = currentNode.data.options || []
        const text = options.length > 0
          ? `${prompt}\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
          : prompt
        if (text.trim()) {
          await ctx.reply(text)
          sentCount++
        }
        currentNode = followEdge(currentNode.id, null)
        continue
      }

      // ── OUTPUT: typing ─────────────────────────────────────────────────
      case 'typing': {
        const seconds = currentNode.data.seconds || 1
        if (ctx.setTyping) await ctx.setTyping(seconds)
        else await new Promise((r) => setTimeout(r, seconds * 1000))
        currentNode = followEdge(currentNode.id, null)
        continue
      }

      // ── INPUT: pause and wait for next message ────────────────────────
      case 'input': {
        const prompt = interpolate(currentNode.data.prompt || '', ctx)
        if (prompt.trim()) {
          await ctx.reply(prompt)
          sentCount++
        }
        // PAUSE — caller persists this; on next message, caller resumes with
        // the input node's id and variableName.
        return {
          sentCount,
          paused: true,
          pausedAtNodeId: currentNode.id,
          variables: ctx.variables,
        }
      }

      // ── INPUT: wait_choice ────────────────────────────────────────────
      case 'wait_choice': {
        const prompt = interpolate(currentNode.data.prompt || '', ctx)
        const options = currentNode.data.options || []
        const text = options.length > 0
          ? `${prompt}\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
          : prompt
        if (text.trim()) {
          await ctx.reply(text)
          sentCount++
        }
        return {
          sentCount,
          paused: true,
          pausedAtNodeId: currentNode.id,
          variables: ctx.variables,
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

        const handle = met ? 'true' : 'false'
        const next = followEdge(currentNode.id, handle)
        if (next) {
          currentNode = next
          continue
        }
        // No matching branch — fall through to default edge if any, else end
        currentNode = followEdge(currentNode.id, null)
        continue
      }

      // ── LOGIC: set_var ────────────────────────────────────────────────
      case 'set_var': {
        const name = currentNode.data.variable || ''
        const val = interpolate(currentNode.data.value || '', ctx)
        if (name) ctx.variables[name] = val
        currentNode = followEdge(currentNode.id, null)
        continue
      }

      // ── LOGIC: delay ──────────────────────────────────────────────────
      case 'delay': {
        const s = Math.max(0, Math.min(60, currentNode.data.seconds || 1))
        await new Promise((r) => setTimeout(r, s * 1000))
        currentNode = followEdge(currentNode.id, null)
        continue
      }

      // ── LOGIC: stop ───────────────────────────────────────────────────
      case 'stop':
        return { sentCount, paused: false, variables: ctx.variables }

      // ── ADVANCED: api_call ────────────────────────────────────────────
      case 'api_call': {
        try {
          const url = interpolate(currentNode.data.url || '', ctx)
          const method = currentNode.data.method || 'GET'
          const headers = currentNode.data.headers ? JSON.parse(currentNode.data.headers) : {}
          const body = currentNode.data.body ? interpolate(currentNode.data.body, ctx) : undefined
          const res = await fetch(url, { method, headers, body })
          const text = await res.text()
          const vname = currentNode.data.variableName
          if (vname) ctx.variables[vname] = text.slice(0, 4000)
        } catch {
          // Silent failure — flow continues
        }
        currentNode = followEdge(currentNode.id, null)
        continue
      }

      // ── ADVANCED: random ──────────────────────────────────────────────
      case 'random': {
        const allEdges = edgesFrom(currentNode.id, undefined)
        if (allEdges.length === 0) {
          currentNode = undefined
          continue
        }
        const pick = allEdges[Math.floor(Math.random() * allEdges.length)]
        currentNode = flow.nodes.find((n) => n.id === pick.target)
        continue
      }

      default:
        // Unknown node type — stop to avoid runaway loops
        return { sentCount, paused: false, variables: ctx.variables, error: `unknown node type: ${currentNode.type}` }
    }
  }

  if (steps >= MAX_STEPS) {
    await ctx.reply('⚠️ Bot flow exceeded maximum steps (possible infinite loop).')
    return { sentCount, paused: false, variables: ctx.variables, error: 'max steps' }
  }

  return { sentCount, paused: false, variables: ctx.variables }
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
  choice: {
    type: 'choice', label: 'Send Choices', category: 'output',
    description: 'Sends a prompt with numbered choices',
    icon: 'ListChecks', color: '#10B981', bg: '#10B9811A',
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
    description: 'Branches based on a variable comparison',
    icon: 'GitBranch', color: '#FBBF24', bg: '#FBBF241A',
    handles: 'true_false',
  },
  set_var: {
    type: 'set_var', label: 'Set Variable', category: 'logic',
    description: 'Sets a variable to a value',
    icon: 'Variable', color: '#FCD34D', bg: '#FCD34D1A',
    handles: 'single',
  },
  delay: {
    type: 'delay', label: 'Delay', category: 'logic',
    description: 'Waits for N seconds before continuing',
    icon: 'Clock', color: '#F59E0B', bg: '#F59E0B1A',
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
    case 'choice':
      return { prompt: 'Pick one:', options: ['Yes', 'No'], variableName: 'choice', label: 'Send Choices' }
    case 'typing':
      return { seconds: 2, label: 'Typing Pause' }
    case 'input':
      return { prompt: 'What is your name?', variableName: 'userName', label: 'Wait for Reply' }
    case 'wait_choice':
      return { prompt: 'Pick one:', options: ['Yes', 'No'], variableName: 'choice', label: 'Wait for Choice' }
    case 'condition':
      return { variable: '', operator: 'exists', value: '', label: 'Condition' }
    case 'set_var':
      return { variable: '', value: '', label: 'Set Variable' }
    case 'delay':
      return { seconds: 1, label: 'Delay' }
    case 'stop':
      return { label: 'Stop' }
    case 'api_call':
      return { url: '', method: 'GET', variableName: 'apiResult', label: 'API Call' }
    case 'random':
      return { label: 'Random Branch' }
  }
}
