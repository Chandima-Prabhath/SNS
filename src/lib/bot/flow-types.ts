/**
 * Visual Bot Builder — Types & Execution Engine
 *
 * Data model: a bot flow is a directed graph stored as JSON.
 *   { nodes: FlowNode[], edges: FlowEdge[] }
 *
 * Node types:
 *   - trigger:   starts the bot (on message, on command, on mention)
 *   - message:   sends a text response
 *   - condition: branches based on a condition (true/false edges)
 *   - delay:     waits N seconds
 *   - input:     waits for user reply, stores in a variable
 *   - apiCall:   calls an external API
 */

export type NodeType = 'trigger' | 'message' | 'condition' | 'delay' | 'input' | 'apiCall'

export interface FlowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: {
    // trigger
    triggerType?: 'command' | 'mention' | 'message'
    command?: string // e.g. "/poll"
    // message
    text?: string
    // condition
    variable?: string
    operator?: 'equals' | 'contains' | 'exists' | 'not_exists'
    value?: string
    // delay
    seconds?: number
    // input
    prompt?: string
    variableName?: string
    // apiCall
    url?: string
    method?: 'GET' | 'POST'
    headers?: string
    body?: string
    // common
    label?: string
  }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null // 'true' | 'false' for conditions, null for sequential
}

export interface BotFlow {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface BotExecutionContext {
  channelId: string
  senderId: string
  senderName: string
  messageId: string
  body: string
  args: string[]
  command?: string
  variables: Record<string, string>
}

export interface BotExecutionResult {
  messages: string[] // messages to send
  error?: string
}

/**
 * Execute a bot flow.
 * Walks the graph starting from the trigger node, following edges.
 * Returns messages to send.
 *
 * Safety: max 50 steps to prevent infinite loops.
 */
export async function executeBotFlow(
  flow: BotFlow,
  ctx: BotExecutionContext
): Promise<BotExecutionResult> {
  const messages: string[] = []
  const MAX_STEPS = 50
  let steps = 0

  // Find the trigger node
  const trigger = flow.nodes.find((n) => n.type === 'trigger')
  if (!trigger) {
    return { messages, error: 'No trigger node found' }
  }

  // Check if the trigger matches
  if (trigger.data.triggerType === 'command' && trigger.data.command) {
    if (!ctx.command || ctx.command !== trigger.data.command.replace(/^\//, '')) {
      return { messages } // trigger doesn't match — bot stays silent
    }
  }

  // Build adjacency map
  const edgesFrom = (nodeId: string, handle?: string | null) =>
    flow.edges.filter(
      (e) => e.source === nodeId && (handle === undefined || e.sourceHandle === handle || (!handle && !e.sourceHandle))
    )

  // Walk the graph
  let currentNode: FlowNode | undefined = trigger

  while (currentNode && steps < MAX_STEPS) {
    steps++

    switch (currentNode.type) {
      case 'trigger':
        // Just follow the next edge
        break

      case 'message':
        if (currentNode.data.text) {
          // Replace variables in text: {{varName}}
          let text = currentNode.data.text
          for (const [key, val] of Object.entries(ctx.variables)) {
            text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
          }
          text = text.replace(/\{\{sender\}\}/g, ctx.senderName)
          text = text.replace(/\{\{args\}\}/g, ctx.args.join(' '))
          messages.push(text)
        }
        break

      case 'condition': {
        const varName = currentNode.data.variable || ''
        const varValue = ctx.variables[varName] || ''
        const operator = currentNode.data.operator || 'exists'
        const compareValue = currentNode.data.value || ''

        let conditionMet = false
        switch (operator) {
          case 'equals':
            conditionMet = varValue === compareValue
            break
          case 'contains':
            conditionMet = varValue.includes(compareValue)
            break
          case 'exists':
            conditionMet = !!varValue
            break
          case 'not_exists':
            conditionMet = !varValue
            break
        }

        // Follow the true or false edge
        const handle = conditionMet ? 'true' : 'false'
        const nextEdges = edgesFrom(currentNode.id, handle)
        if (nextEdges.length > 0) {
          const nextNode = flow.nodes.find((n) => n.id === nextEdges[0].target)
          if (nextNode) {
            currentNode = nextNode
            continue // skip the default edge following below
          }
        }
        currentNode = undefined
        continue
      }

      case 'delay':
        await new Promise((resolve) => setTimeout(resolve, (currentNode.data.seconds || 1) * 1000))
        break

      case 'input':
        // For now, inputs are handled as conversation state — just store the prompt
        // In a full implementation, this would pause execution and wait for the user's reply
        if (currentNode.data.prompt) {
          messages.push(currentNode.data.prompt)
        }
        break

      case 'apiCall': {
        try {
          const url = currentNode.data.url || ''
          const method = currentNode.data.method || 'GET'
          const headers = currentNode.data.headers ? JSON.parse(currentNode.data.headers) : {}
          const body = currentNode.data.body || undefined

          const response = await fetch(url, { method, headers, body })
          const text = await response.text()
          if (currentNode.data.variableName) {
            ctx.variables[currentNode.data.variableName] = text.slice(0, 1000) // cap at 1KB
          }
        } catch (e) {
          // API call failed — continue silently
        }
        break
      }
    }

    // Follow the default edge (no handle)
    const nextEdges = edgesFrom(currentNode.id, null)
    if (nextEdges.length > 0) {
      currentNode = flow.nodes.find((n) => n.id === nextEdges[0].target)
    } else {
      currentNode = undefined
    }
  }

  if (steps >= MAX_STEPS) {
    messages.push('⚠️ Bot flow exceeded maximum steps (possible infinite loop).')
  }

  return { messages }
}
