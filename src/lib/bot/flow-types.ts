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
  | 'ai_route'
  | 'send_media'
  | 'log'
  | 'tts'
  | 'asr_transcribe'
  | 'message_type'
  | 'regex_extract'
  | 'json_parse'
  | 'comment'
  | 'music_play'
  | 'music_pause'
  | 'music_skip'
  | 'music_queue_add'
  | 'music_stop'

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
  operator?: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with' | 'exists' | 'not_exists' | 'regex_match' | 'regex_not_match' | 'greater_than' | 'less_than' | 'in_array' | 'not_in_array'
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

  // ── tts ──
  /** Text to speak. Supports {{var}} interpolation. */
  ttsText?: string
  /** Voice name (alba, charles, etc.) or custom voice ID. */
  ttsVoice?: string
  // (sends the audio as a voice message — no variable needed)

  // ── asr_transcribe ──
  /** URL of the audio file to transcribe. Supports {{var}} interpolation.
   *  Typically set to {{mediaUrl}} which the bot framework populates with
   *  the incoming message's mediaUrl when the user sends a voice message. */
  asrAudioUrl?: string
  /** Language hint (currently ignored — Moonshine v1 is English-only). */
  asrLanguage?: string
  /** Whether to also send the transcript as a reply message. If false,
   *  the transcript is only stored in the variable. */
  asrReply?: boolean
  // (uses `variableName` to store the transcript text)

  // ── regex_extract ──
  /** The regex pattern to match against the input. Uses JavaScript RegExp syntax. */
  regexPattern?: string
  /** Flags for the regex (e.g. 'i' for case-insensitive, 'g' for global). */
  regexFlags?: string
  /** The input text to match against. Supports {{var}} interpolation. */
  regexInput?: string
  // (uses `variableName` to store the first match, or matched group 1 if present)

  // ── json_parse ──
  /** The JSON string to parse. Supports {{var}} interpolation — typically {{apiResult}}. */
  jsonInput?: string
  /** JSON path to extract (dot-notation, e.g. 'data.user.name' or 'choices[0].message.content'). */
  jsonPath?: string
  // (uses `variableName` to store the extracted value as a string)

  // ── comment ──
  /** Comment/note text — shown on the canvas, ignored by the engine. */
  commentText?: string
  /** Comment color (for visual categorization). */
  commentColor?: 'yellow' | 'green' | 'blue' | 'pink' | 'gray'

  // ── ai_route (LLM intent routing) ──
  /** The prompt describing what the user might want. The LLM picks one of the
   *  `aiRouteIntents` and the flow branches to the matching output handle. */
  aiRoutePrompt?: string
  /** Optional system prompt to set the LLM's persona. */
  aiRouteSystemPrompt?: string
  /** Ollama model name for routing. Defaults to gemma3:270m (works with
   *  structured JSON output even on small models). */
  aiRouteModel?: string
  /** List of intent labels the LLM can choose from. Each gets its own output
   *  handle (intent_0, intent_1, ...) plus a 'default' fallback handle. */
  aiRouteIntents?: string[]

  // ── music control nodes ──
  /** For music_play: search query (e.g. "Bohemian Rhapsody") or video ID. */
  musicQuery?: string
  /** For music_queue_add: same as musicQuery — the song to add to the queue. */
  // (reuses musicQuery)

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
   *  Telegram-style inline buttons to the message. Returns the message ID. */
  reply: (text: string, keyboard?: BotKeyboardButton[][]) => Promise<string>

  /** Reply with media (image/video/audio). The URL should be a path like
   *  /api/uploads/xxx.wav. Returns the message ID. */
  replyWithMedia?: (mediaUrl: string, mediaType: string, caption?: string) => Promise<string>

  /** Edit an existing bot message in-place (body + keyboard). Used for
   *  Telegram-style keyboard updates when a wait_choice loops back. */
  editMessage?: (messageId: string, text: string, keyboard?: BotKeyboardButton[][]) => Promise<void>

  /** Generate TTS audio from text using Pocket TTS. Returns the media URL
   *  (e.g. /api/uploads/tts-bot-xxx.wav) or null if generation failed.
   *  Server-only — debug mode should return null and let the engine fall
   *  back to sending text. */
  generateTTS?: (text: string, voice: string) => Promise<string | null>

  /** Transcribe an audio file URL to text using Moonshine ASR. Returns the
   *  transcript text or null if transcription failed (server down, no audio,
   *  etc.). Server-only — debug mode should return null and let the engine
   *  log a clear error. */
  transcribeAudio?: (mediaUrl: string, language?: string) => Promise<string | null>

  /** Show typing indicator — best-effort, no-op if unsupported. */
  setTyping?: (seconds: number) => Promise<void>

  /** Control the user's music player via server→client socket event.
   *  targetUserId is typically ctx.senderId (the person who triggered the bot). */
  controlMusic?: (targetUserId: string, command: {
    action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'
    query?: string
  }) => Promise<void>
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
  | { type: 'asr_call'; timestamp: number; nodeId: string; audioUrl: string; transcriptLength: number; durationMs: number; success: boolean }
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
  // Use String.replaceAll instead of new RegExp — variable names can
  // contain regex metacharacters (e.g. if a user names a variable
  // 'count.', '(.*)', or 'a+b'), which would either throw a SyntaxError
  // or match unexpected substrings. replaceAll with a string pattern
  // treats it as a literal.
  for (const [k, v] of Object.entries(ctx.variables)) {
    out = out.replaceAll(`{{${k}}}`, v)
  }
  out = out.replaceAll('{{sender}}', ctx.senderName)
  out = out.replaceAll('{{args}}', ctx.args.join(' '))
  out = out.replaceAll('{{body}}', ctx.body)
  // Convenience: expose the incoming message's media URL/type and any
  // pre-existing ASR transcript as {{mediaUrl}}, {{mediaType}}, {{transcript}}.
  // These are also available as ctx.variables (set by visual.ts at flow start)
  // but the explicit fallbacks here make them work even in debug mode.
  out = out.replaceAll('{{mediaUrl}}', ctx.variables.__mediaUrl || '')
  out = out.replaceAll('{{mediaType}}', ctx.variables.__mediaType || '')
  // IMPORTANT: prefer the user-set 'transcript' variable (from an explicit
  // asr_transcribe node) over the auto-set '__transcript' (from the incoming
  // message's auto-transcription). The auto-transcript may be stale or empty,
  // and the user's explicit ASR node should take precedence.
  out = out.replaceAll('{{transcript}}', ctx.variables.transcript || ctx.variables.__transcript || '')
  // Also expose the detected message type (set by the message_type node)
  out = out.replaceAll('{{messageType}}', ctx.variables.__messageType || '')
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

    try {
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

        // Telegram-style behavior: if we have an existing keyboard message
        // (from a previous pause at this node, i.e. a loop-back), EDIT it
        // in-place instead of sending a new message. This prevents the bot
        // from spamming new keyboard messages every time the user clicks a
        // button that loops back to this menu.
        //
        // The keyboardMessageId is set in the session state by visual.ts
        // when it persists the pause. We read it from ctx.variables under
        // a reserved key.
        const existingKeyboardMsgId = ctx.variables['__keyboardMsgId']

        if (prompt.trim()) {
          if (existingKeyboardMsgId && ctx.editMessage) {
            // Edit-in-place: update the existing keyboard message
            await ctx.editMessage(existingKeyboardMsgId, prompt, keyboard)
            trace.push({ type: 'message_sent', timestamp: now(), nodeId: currentNode.id, text: `[edited] ${prompt}` })
          } else {
            // Fresh keyboard: send a new message
            const msgId = await ctx.reply(prompt, keyboard)
            sentCount++
            // Store the message ID so future re-pauses can edit it
            ctx.variables['__keyboardMsgId'] = msgId
            trace.push({ type: 'message_sent', timestamp: now(), nodeId: currentNode.id, text: prompt })
          }
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
        // Interpolate the comparison value so {{sender}}, {{body}}, {{mediaType}},
        // {{transcript}} etc. work in condition comparisons.
        const cmp = interpolate(currentNode.data.value || '', ctx)

        let met = false
        switch (op) {
          case 'equals':       met = varValue === cmp; break
          case 'not_equals':   met = varValue !== cmp; break
          case 'contains':     met = varValue.includes(cmp); break
          case 'starts_with':  met = varValue.startsWith(cmp); break
          case 'ends_with':    met = varValue.endsWith(cmp); break
          case 'exists':       met = !!varValue; break
          case 'not_exists':   met = !varValue; break
          case 'regex_match': {
            try { met = new RegExp(cmp).test(varValue) } catch { met = false }
            break
          }
          case 'regex_not_match': {
            try { met = !new RegExp(cmp).test(varValue) } catch { met = false }
            break
          }
          case 'greater_than': {
            const a = parseFloat(varValue), b = parseFloat(cmp)
            met = !isNaN(a) && !isNaN(b) && a > b
            break
          }
          case 'less_than': {
            const a = parseFloat(varValue), b = parseFloat(cmp)
            met = !isNaN(a) && !isNaN(b) && a < b
            break
          }
          case 'in_array': {
            // cmp is a comma-separated list, e.g. "yes,yep,ok,confirm"
            const items = cmp.split(',').map((s) => s.trim()).filter(Boolean)
            met = items.includes(varValue)
            break
          }
          case 'not_in_array': {
            const items = cmp.split(',').map((s) => s.trim()).filter(Boolean)
            met = !items.includes(varValue)
            break
          }
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

      // ── LOGIC: message_type (route by message type) ──────────────────
      case 'message_type': {
        // Determine the message type from mediaType + mediaUrl + body
        const mediaType = ctx.variables.__mediaType || ''
        const mediaUrl = ctx.variables.__mediaUrl || ''
        const body = ctx.body || ''

        let detectedType: string
        if (mediaType.startsWith('audio')) {
          // Distinguish voice recordings from audio file uploads:
          // - voice recordings: mediaType is 'audio/webm', 'audio/ogg', 'audio/mp4' (from MediaRecorder)
          // - audio files: mediaType is 'audio' (TTS-generated) or 'audio/mpeg', 'audio/flac' (uploaded)
          // Heuristic: 'audio/webm', 'audio/ogg', 'audio/mp4' → voice; 'audio' or 'audio/mpeg' → audio
          if (mediaType === 'audio/webm' || mediaType === 'audio/ogg' || mediaType === 'audio/mp4' || mediaType === 'audio/m4a') {
            detectedType = 'voice'
          } else {
            detectedType = 'audio'
          }
        } else if (mediaType.startsWith('image')) {
          detectedType = 'image'
        } else if (mediaType.startsWith('video')) {
          detectedType = 'video'
        } else if (mediaUrl && !body) {
          // Has a media URL but no text body and not audio/image/video → treat as file
          detectedType = 'file'
        } else if (body && !mediaUrl) {
          detectedType = 'text'
        } else if (mediaUrl && body) {
          // Text + media → treat as text (the body is the caption)
          detectedType = 'text'
        } else {
          detectedType = 'other'
        }

        // Expose the detected type as a variable for downstream nodes
        ctx.variables.__messageType = detectedType

        trace.push({
          type: 'branch_taken',
          timestamp: now(),
          nodeId: currentNode.id,
          handle: detectedType,
          targetNodeId: followEdge(currentNode.id, detectedType)?.id || '',
        })

        const next = followEdge(currentNode.id, detectedType)
        if (next) {
          currentNode = next
        } else {
          // No edge for this type — fall through to 'other' or null
          const fallback = followEdge(currentNode.id, 'other') || followEdge(currentNode.id, null)
          if (fallback) {
            trace.push({ type: 'branch_taken', timestamp: now(), nodeId: currentNode.id, handle: 'fallback', targetNodeId: fallback.id })
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
        // Interpolate each case value so {{var}} placeholders work
        const cases = (currentNode.data.cases || []).map((c) => interpolate(c, ctx))

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

      // ── LOGIC: regex_extract ──────────────────────────────────────────
      case 'regex_extract': {
        const pattern = currentNode.data.regexPattern || ''
        const flags = currentNode.data.regexFlags || 'i'
        const input = interpolate(currentNode.data.regexInput || '{{body}}', ctx)
        const vname = currentNode.data.variableName || 'match'

        if (!pattern) {
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: 'Regex node has empty pattern' })
          ctx.variables[vname] = ''
          currentNode = followEdge(currentNode.id, null)
          break
        }

        let matched = ''
        try {
          const re = new RegExp(pattern, flags)
          const m = re.exec(input)
          if (m) {
            // If the regex has capture groups, return group 1; otherwise return the full match
            matched = m[1] !== undefined ? m[1] : m[0]
          }
        } catch (e: any) {
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: `Invalid regex: ${e?.message || e}` })
        }

        ctx.variables[vname] = matched
        trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: matched.slice(0, 100) })
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── LOGIC: json_parse ─────────────────────────────────────────────
      case 'json_parse': {
        const input = interpolate(currentNode.data.jsonInput || '{{apiResult}}', ctx)
        const path = currentNode.data.jsonPath || ''
        const vname = currentNode.data.variableName || 'jsonValue'

        if (!input.trim()) {
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: 'JSON node has empty input' })
          ctx.variables[vname] = ''
          currentNode = followEdge(currentNode.id, null)
          break
        }

        let result = ''
        try {
          const parsed = JSON.parse(input)
          if (path) {
            // Navigate dot-notation path with array index support
            // e.g. 'data.user.name' or 'choices[0].message.content'
            const parts = path.split(/\.|\[(\d+)\]/).filter(Boolean)
            let cur: any = parsed
            for (const part of parts) {
              if (cur == null) break
              cur = cur[part]
            }
            result = cur == null ? '' : (typeof cur === 'object' ? JSON.stringify(cur) : String(cur))
          } else {
            result = typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)
          }
        } catch (e: any) {
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: `JSON parse failed: ${e?.message || e}` })
        }

        ctx.variables[vname] = result
        trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: result.slice(0, 100) })
        currentNode = followEdge(currentNode.id, null)
        break
      }

      // ── LOGIC: comment (visual note, no execution) ───────────────────
      case 'comment': {
        // Comments are purely visual — they don't do anything when the flow
        // runs. Just pass through to the next node.
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

      // ── OUTPUT: tts (Pocket TTS voice message) ────────────────────────
      case 'tts': {
        const ttsStart = now()
        const ttsNode = currentNode
        const text = interpolate(ttsNode.data.ttsText || '', ctx)
        const voice = ttsNode.data.ttsVoice || 'alba'

        // Show typing indicator while TTS generates (can take 2-10s)
        if (ctx.setTyping) await ctx.setTyping(10)

        if (!text.trim()) {
          trace.push({ type: 'error', timestamp: now(), nodeId: ttsNode.id, message: 'TTS node has empty text' })
          currentNode = followEdge(ttsNode.id, null)
          break
        }

        trace.push({ type: 'log', timestamp: now(), nodeId: ttsNode.id, level: 'info', message: `TTS: generating "${text.slice(0, 60)}…" with voice=${voice}` })

        let mediaUrl: string | null = null
        if (ctx.generateTTS) {
          try {
            mediaUrl = await ctx.generateTTS(text, voice)
          } catch (e: any) {
            trace.push({ type: 'error', timestamp: now(), nodeId: ttsNode.id, message: `TTS failed: ${e?.message || e}` })
          }
        } else {
          // Debug mode — no actual TTS available
          trace.push({ type: 'error', timestamp: now(), nodeId: ttsNode.id, message: 'TTS not available in debug mode' })
        }

        if (mediaUrl) {
          // Send as a voice message
          if (ctx.replyWithMedia) {
            await ctx.replyWithMedia(mediaUrl, 'audio')
          } else {
            await ctx.reply(`🔊 ${mediaUrl}`)
          }
          sentCount++
          trace.push({ type: 'message_sent', timestamp: now(), nodeId: ttsNode.id, text: `[voice message: ${text.slice(0, 60)}…]` })
          trace.push({ type: 'ai_call', timestamp: now(), nodeId: ttsNode.id, model: `tts:${voice}`, prompt: text.slice(0, 100), responseLength: 0, durationMs: now() - ttsStart })
        } else {
          // Fallback: send the text as a plain message
          await ctx.reply(`🔊 ${text}`)
          sentCount++
          trace.push({ type: 'message_sent', timestamp: now(), nodeId: ttsNode.id, text: `[TTS fallback] ${text.slice(0, 80)}` })
        }
        currentNode = followEdge(ttsNode.id, null)
        break
      }

      // ── ADVANCED: asr_transcribe (Moonshine ASR voice-to-text) ───────
      case 'asr_transcribe': {
        const asrStart = now()
        const asrNode = currentNode
        const audioUrl = interpolate(asrNode.data.asrAudioUrl || '{{mediaUrl}}', ctx)
        const language = asrNode.data.asrLanguage || 'en'
        const shouldReply = asrNode.data.asrReply !== false // default true
        const vname = asrNode.data.variableName || 'transcript'

        // Show typing indicator while ASR transcribes (can take 1-15s)
        if (ctx.setTyping) await ctx.setTyping(15)

        if (!audioUrl || !audioUrl.trim()) {
          trace.push({ type: 'error', timestamp: now(), nodeId: asrNode.id, message: 'ASR node has no audio URL (set asrAudioUrl or send a voice message)' })
          currentNode = followEdge(asrNode.id, null)
          break
        }

        trace.push({ type: 'log', timestamp: now(), nodeId: asrNode.id, level: 'info', message: `ASR: transcribing "${audioUrl.slice(0, 60)}…" (lang=${language})` })

        let transcript: string | null = null
        if (ctx.transcribeAudio) {
          try {
            transcript = await ctx.transcribeAudio(audioUrl, language)
          } catch (e: any) {
            trace.push({ type: 'error', timestamp: now(), nodeId: asrNode.id, message: `ASR failed: ${e?.message || e}` })
          }
        } else {
          // Debug mode — no actual ASR available
          trace.push({ type: 'error', timestamp: now(), nodeId: asrNode.id, message: 'ASR not available in debug mode' })
        }

        const transcriptText = transcript?.trim() || ''
        const success = !!transcriptText

        // Store in variable (even if empty — downstream condition nodes can check `exists`)
        ctx.variables[vname] = transcriptText
        trace.push({ type: 'variable_set', timestamp: now(), nodeId: asrNode.id, variable: vname, value: transcriptText.slice(0, 100) })
        trace.push({
          type: 'asr_call',
          timestamp: now(),
          nodeId: asrNode.id,
          audioUrl: audioUrl.slice(0, 100),
          transcriptLength: transcriptText.length,
          durationMs: now() - asrStart,
          success,
        })

        // Optionally send the transcript as a reply (default behavior)
        if (shouldReply && transcriptText) {
          await ctx.reply(`📝 ${transcriptText}`)
          sentCount++
          trace.push({ type: 'message_sent', timestamp: now(), nodeId: asrNode.id, text: `[transcript] ${transcriptText.slice(0, 80)}` })
        } else if (shouldReply && !transcriptText) {
          await ctx.reply('📝 (transcription unavailable — no speech detected or ASR server down)')
          sentCount++
        }

        currentNode = followEdge(asrNode.id, null)
        break
      }

      // ── ADVANCED: api_call ────────────────────────────────────────────
      case 'api_call': {
        const callStart = now()
        // Show typing indicator while the API call runs (can take 1-30s)
        if (ctx.setTyping) await ctx.setTyping(15)
        try {
          const url = interpolate(currentNode.data.url || '', ctx)
          const method = currentNode.data.method || 'GET'
          const headers = currentNode.data.headers ? JSON.parse(currentNode.data.headers) : {}
          const body = currentNode.data.body ? interpolate(currentNode.data.body, ctx) : undefined

          // SSRF guard: block requests to private/loopback IPs unless the
          // admin explicitly allows it via BOT_API_ALLOW_PRIVATE=1.
          // Without this, any user who can edit a bot (or whose message
          // interpolates into {{body}}={{url}}) could make the server
          // fetch internal URLs (cloud metadata service, Ollama, Redis…).
          const apiNodeId = currentNode.id
          const allowPrivate = process.env.BOT_API_ALLOW_PRIVATE === '1'
          if (!allowPrivate) {
            try {
              const parsed = new URL(url)
              const host = parsed.hostname
              const isLoopback = /^(127\.|localhost$|::1$)/i.test(host) ||
                host.endsWith('.localhost') ||
                /^169\.254\./.test(host) // link-local (cloud metadata)
              const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)
              if (isLoopback || isPrivate) {
                trace.push({
                  type: 'error', timestamp: now(), nodeId: apiNodeId,
                  message: `SSRF guard: blocked request to private/loopback host '${host}'. Set BOT_API_ALLOW_PRIVATE=1 to allow.`
                })
                currentNode = followEdge(apiNodeId, null)
                break
              }
            } catch {
              trace.push({ type: 'error', timestamp: now(), nodeId: apiNodeId, message: `api_call: invalid URL '${url.slice(0, 100)}'` })
              currentNode = followEdge(apiNodeId, null)
              break
            }
          }

          // 30s timeout — external APIs should respond within this window.
          // Prevents a slow/down API from hanging the bot forever.
          const apiController = new AbortController()
          const apiTimeout = setTimeout(() => apiController.abort(), 30_000)
          const res = await fetch(url, { method, headers, body, signal: apiController.signal })
          clearTimeout(apiTimeout)
          const text = await res.text()
          const vname = currentNode.data.variableName
          if (vname) {
            ctx.variables[vname] = text.slice(0, 4000)
            trace.push({ type: 'variable_set', timestamp: now(), nodeId: currentNode.id, variable: vname, value: text.slice(0, 200) + (text.length > 200 ? '…' : '') })
          }
          trace.push({ type: 'api_call', timestamp: now(), nodeId: currentNode.id, url, method, status: res.status, durationMs: now() - callStart })
        } catch (e: any) {
          const errMsg = e?.name === 'AbortError'
            ? `API call timed out (>30s)`
            : `API call failed: ${e?.message || e}`
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: errMsg })
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
        // Show typing indicator while the LLM generates (can take 5-30s)
        if (ctx.setTyping) await ctx.setTyping(30)
        try {
          const model = currentNode.data.aiModel || 'gemma3:270m'
          const prompt = interpolate(currentNode.data.aiPrompt || '', ctx)
          const systemPrompt = currentNode.data.aiSystemPrompt
            ? interpolate(currentNode.data.aiSystemPrompt, ctx)
            : undefined
          const temperature = currentNode.data.aiTemperature ?? 0.7
          const maxTokens = currentNode.data.aiMaxTokens ?? 256

          const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
          // 15s timeout — Ollama with gemma3:270m should respond in <2s.
          // If it hangs (model loading, OOM, etc.), abort and show an error
          // instead of hanging the entire bot dispatch forever.
          const aiController = new AbortController()
          const aiTimeout = setTimeout(() => aiController.abort(), 15_000)
          let res: Response
          try {
            res = await fetch(`${ollamaUrl}/api/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model, prompt, system: systemPrompt, stream: false,
                options: { temperature, num_predict: maxTokens },
              }),
              signal: aiController.signal,
            })
          } catch (fetchErr: any) {
            clearTimeout(aiTimeout)
            const errMsg = fetchErr?.name === 'AbortError'
              ? `Ollama timed out (>15s) — is the model loaded?`
              : `Ollama fetch failed: ${fetchErr?.message || fetchErr}`
            ctx.variables[vname] = `[AI error: timeout]`
            trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: errMsg })
            trace.push({ type: 'ai_call', timestamp: now(), nodeId: currentNode.id, model, prompt: prompt.slice(0, 100), responseLength: 0, durationMs: now() - callStart })
            currentNode = followEdge(currentNode.id, null)
            break
          }
          clearTimeout(aiTimeout)

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

      // ── ADVANCED: ai_route (LLM intent routing via structured JSON) ──
      case 'ai_route': {
        const routeStart = now()
        const routeNode = currentNode
        const intents = routeNode.data.aiRouteIntents || []
        const prompt = interpolate(routeNode.data.aiRoutePrompt || 'What does the user want?', ctx)
        const systemPrompt = routeNode.data.aiRouteSystemPrompt || 'You are a routing assistant. Pick the best intent.'
        const model = routeNode.data.aiRouteModel || 'gemma3:270m'

        if (intents.length === 0) {
          trace.push({ type: 'error', timestamp: now(), nodeId: routeNode.id, message: 'AI Route node has no intents defined' })
          currentNode = followEdge(routeNode.id, 'default') || followEdge(routeNode.id, null)
          break
        }

        if (ctx.setTyping) await ctx.setTyping(15)

        // Use Ollama structured output (format: json schema) so even small
        // models like gemma3:270m can reliably return a structured intent.
        // The LLM picks one of the intent labels and we route to the matching
        // output handle (intent_0, intent_1, ...).
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
        const routeController = new AbortController()
        const routeTimeout = setTimeout(() => routeController.abort(), 15_000)

        try {
          const intentList = intents.map((i, idx) => `${idx}: ${i}`).join('\n')
          const fullPrompt = `${prompt}\n\nUser message: "${ctx.body}"\n\nAvailable intents:\n${intentList}\n\nRespond with JSON: {"intent": "the label you pick"}`

          const res = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt: fullPrompt,
              system: systemPrompt,
              stream: false,
              format: { type: 'object', properties: { intent: { type: 'string' } }, required: ['intent'] },
              options: { temperature: 0.3, num_predict: 50 },
            }),
            signal: routeController.signal,
          })
          clearTimeout(routeTimeout)

          if (!res.ok) {
            throw new Error(`Ollama error ${res.status}`)
          }

          const data = await res.json()
          let pickedIntent = ''
          try {
            const parsed = JSON.parse(data.response)
            pickedIntent = (parsed.intent || '').trim()
          } catch {
            // If JSON parse fails, try to find the intent in the raw text
            pickedIntent = intents.find((i) => data.response?.includes(i)) || ''
          }

          // Find the matching intent index (fuzzy: case-insensitive, partial match)
          const matchIdx = intents.findIndex((i) =>
            i.toLowerCase() === pickedIntent.toLowerCase() ||
            i.toLowerCase().includes(pickedIntent.toLowerCase()) ||
            pickedIntent.toLowerCase().includes(i.toLowerCase())
          )

          const handle = matchIdx >= 0 ? `intent_${matchIdx}` : 'default'
          trace.push({ type: 'ai_call', timestamp: now(), nodeId: routeNode.id, model, prompt: prompt.slice(0, 100), responseLength: pickedIntent.length, durationMs: now() - routeStart })
          trace.push({ type: 'branch_taken', timestamp: now(), nodeId: routeNode.id, handle, targetNodeId: followEdge(routeNode.id, handle)?.id || '' })

          const next = followEdge(routeNode.id, handle) || followEdge(routeNode.id, null)
          if (next) {
            currentNode = next
          } else {
            trace.push({ type: 'flow_end', timestamp: now(), reason: 'no_edge', sentCount })
            currentNode = undefined
          }
        } catch (e: any) {
          clearTimeout(routeTimeout)
          trace.push({ type: 'error', timestamp: now(), nodeId: routeNode.id, message: `AI route failed: ${e?.message || e}` })
          // Fall back to default handle on error
          const fallback = followEdge(routeNode.id, 'default') || followEdge(routeNode.id, null)
          if (fallback) {
            currentNode = fallback
          } else {
            currentNode = undefined
          }
        }
        break
      }

      // ── MUSIC CONTROL NODES ───────────────────────────────────────────

      case 'music_play': {
        const query = interpolate(currentNode.data.musicQuery || '{{body}}', ctx)
        if (ctx.controlMusic && query) {
          await ctx.controlMusic(ctx.senderId, { action: 'play', query })
          trace.push({ type: 'log', timestamp: now(), nodeId: currentNode.id, level: 'info', message: `Music: playing "${query}"` })
        } else if (!ctx.controlMusic) {
          trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: 'Music control not available' })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      case 'music_pause': {
        if (ctx.controlMusic) {
          await ctx.controlMusic(ctx.senderId, { action: 'pause' })
          trace.push({ type: 'log', timestamp: now(), nodeId: currentNode.id, level: 'info', message: 'Music: paused' })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      case 'music_skip': {
        if (ctx.controlMusic) {
          await ctx.controlMusic(ctx.senderId, { action: 'skip' })
          trace.push({ type: 'log', timestamp: now(), nodeId: currentNode.id, level: 'info', message: 'Music: skipped' })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      case 'music_queue_add': {
        const query = interpolate(currentNode.data.musicQuery || '{{body}}', ctx)
        if (ctx.controlMusic && query) {
          await ctx.controlMusic(ctx.senderId, { action: 'queue', query })
          trace.push({ type: 'log', timestamp: now(), nodeId: currentNode.id, level: 'info', message: `Music: queued "${query}"` })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      case 'music_stop': {
        if (ctx.controlMusic) {
          await ctx.controlMusic(ctx.senderId, { action: 'stop' })
          trace.push({ type: 'log', timestamp: now(), nodeId: currentNode.id, level: 'info', message: 'Music: stopped' })
        }
        currentNode = followEdge(currentNode.id, null)
        break
      }

      default:
        trace.push({ type: 'error', timestamp: now(), nodeId: currentNode.id, message: `unknown node type: ${currentNode.type}` })
        return { sentCount, paused: false, variables: ctx.variables, trace, error: `unknown node type: ${currentNode.type}` }
      }
    } catch (e: any) {
      // Top-level catch — any node throwing would otherwise abort the entire
      // flow silently. Log the error, try to reply to the user so they know
      // something went wrong, and stop the flow gracefully.
      const errMsg = e?.message || String(e)
      const errNodeId = currentNode?.id || ''
      trace.push({ type: 'error', timestamp: now(), nodeId: errNodeId, message: `Node "${nodeLabel}" threw: ${errMsg}` })
      try {
        await ctx.reply(`⚠️ Bot error in "${nodeLabel}": ${errMsg.slice(0, 200)}`)
        sentCount++
      } catch {
        // reply also failed — nothing more we can do
      }
      trace.push({ type: 'flow_end', timestamp: now(), reason: 'error', sentCount })
      return { sentCount, paused: false, variables: ctx.variables, trace, error: `Node ${errNodeId} threw: ${errMsg}` }
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
  tts: {
    type: 'tts', label: 'Voice Message', category: 'output',
    description: 'Generates a TTS voice message from text using Pocket TTS',
    icon: 'AudioLines', color: '#F472B6', bg: '#F472B61A',
    handles: 'single',
  },
  asr_transcribe: {
    type: 'asr_transcribe', label: 'Transcribe Audio', category: 'advanced',
    description: 'Transcribes a voice message to text using Moonshine ASR',
    icon: 'AudioLines', color: '#22D3EE', bg: '#22D3EE1A',
    handles: 'single',
  },
  message_type: {
    type: 'message_type', label: 'Message Type', category: 'logic',
    description: 'Routes the flow based on the type of incoming message (text, voice, image, etc.)',
    icon: 'Split', color: '#60A5FA', bg: '#60A5FA1A',
    handles: 'multi',
  },
  regex_extract: {
    type: 'regex_extract', label: 'Regex Extract', category: 'advanced',
    description: 'Extracts text matching a regex pattern from a variable',
    icon: 'Braces', color: '#A78BFA', bg: '#A78BFA1A',
    handles: 'single',
  },
  json_parse: {
    type: 'json_parse', label: 'JSON Parse', category: 'advanced',
    description: 'Parses a JSON string and extracts a value by path (e.g. apiResult → choices[0].message)',
    icon: 'Braces', color: '#34D399', bg: '#34D3991A',
    handles: 'single',
  },
  comment: {
    type: 'comment', label: 'Comment', category: 'logic',
    description: 'A visual note — does nothing when the flow runs. Use to document your bot.',
    icon: 'Terminal', color: '#FBBF24', bg: '#FBBF241A',
    handles: 'single',
  },
  ai_route: {
    type: 'ai_route', label: 'AI Route', category: 'advanced',
    description: 'LLM picks an intent and routes the flow — works with small models via structured JSON output',
    icon: 'GitBranch', color: '#A78BFA', bg: '#A78BFA1A',
    handles: 'multi',
  },
  music_play: {
    type: 'music_play', label: 'Play Music', category: 'output',
    description: 'Plays a song on the user\'s music player by search query or video ID',
    icon: 'AudioLines', color: '#22D3EE', bg: '#22D3EE1A',
    handles: 'single',
  },
  music_pause: {
    type: 'music_pause', label: 'Pause Music', category: 'output',
    description: 'Pauses the user\'s music player',
    icon: 'AudioLines', color: '#FBBF24', bg: '#FBBF241A',
    handles: 'single',
  },
  music_skip: {
    type: 'music_skip', label: 'Skip Song', category: 'output',
    description: 'Skips to the next song in the queue',
    icon: 'AudioLines', color: '#34D399', bg: '#34D3991A',
    handles: 'single',
  },
  music_queue_add: {
    type: 'music_queue_add', label: 'Add to Queue', category: 'output',
    description: 'Adds a song to the music queue without playing it immediately',
    icon: 'AudioLines', color: '#F472B6', bg: '#F472B61A',
    handles: 'single',
  },
  music_stop: {
    type: 'music_stop', label: 'Stop Music', category: 'output',
    description: 'Stops music playback and clears the queue',
    icon: 'AudioLines', color: '#F87171', bg: '#F871711A',
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
    case 'tts':
      return {
        label: 'Voice Message',
        ttsText: 'Hello {{sender}}! This is a voice message from the bot.',
        ttsVoice: 'alba',
      }
    case 'asr_transcribe':
      return {
        label: 'Transcribe Audio',
        asrAudioUrl: '{{mediaUrl}}',
        asrLanguage: 'en',
        asrReply: true,
        variableName: 'transcript',
      }
    case 'message_type':
      return {
        label: 'Message Type',
      }
    case 'regex_extract':
      return {
        label: 'Regex Extract',
        regexPattern: '\\d+',  // default: extract first number
        regexFlags: '',
        regexInput: '{{body}}',
        variableName: 'match',
      }
    case 'json_parse':
      return {
        label: 'JSON Parse',
        jsonInput: '{{apiResult}}',
        jsonPath: '',
        variableName: 'jsonValue',
      }
    case 'comment':
      return {
        label: 'Comment',
        commentText: 'This is a note. It does nothing when the flow runs.',
        commentColor: 'yellow',
      }
    case 'ai_route':
      return {
        label: 'AI Route',
        aiRoutePrompt: 'What does the user want to do?',
        aiRouteSystemPrompt: 'You are a routing assistant. Pick the best intent based on the user\'s message.',
        aiRouteModel: 'functiongemma',
        aiRouteIntents: ['play_music', 'tell_joke', 'ask_question'],
      }
    case 'music_play':
      return {
        label: 'Play Music',
        musicQuery: '{{body}}',
      }
    case 'music_pause':
      return { label: 'Pause Music' }
    case 'music_skip':
      return { label: 'Skip Song' }
    case 'music_queue_add':
      return {
        label: 'Add to Queue',
        musicQuery: '{{body}}',
      }
    case 'music_stop':
      return { label: 'Stop Music' }
  }
}
