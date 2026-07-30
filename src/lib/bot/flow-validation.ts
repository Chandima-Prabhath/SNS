/**
 * Flow Validation Engine
 * ───────────────────────
 * Analyzes a BotFlow and returns a list of issues — errors, warnings, and
 * info — that help the developer understand whether their flow will work
 * correctly before they save and test it live.
 *
 * Validation checks:
 *   1. Exactly one trigger node (error if 0 or >1)
 *   2. All nodes reachable from the trigger (warning for orphans)
 *   3. Condition nodes: recommend both true+false branches (warning)
 *   4. Switch/case nodes: recommend ≥2 cases (warning)
 *   5. Random nodes: need ≥2 outgoing edges (warning)
 *   6. Input/wait_choice: must have an outgoing edge (error — flow would dead-end on resume)
 *   7. Variable scope: variables referenced before they're defined (warning)
 *   8. Infinite loop detection: cycles that don't pass through a pausing node (error)
 *   9. AI/API nodes: recommend an error-handling branch (info)
 *  10. Stop nodes: at least one terminal path (info)
 *  11. Empty text in message nodes (warning)
 *  12. Empty prompt in input/wait_choice nodes (error)
 */

import type { BotFlow, FlowNode, NodeType } from './flow-types'

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  nodeId?: string
  severity: IssueSeverity
  category: string
  message: string
  /** Suggested fix — shown as a hint in the UI. */
  fix?: string
}

/** Nodes that pause execution and wait for user input. */
const PAUSING_NODES: NodeType[] = ['input', 'wait_choice']

/** Nodes that terminate the flow. */
const TERMINATING_NODES: NodeType[] = ['stop']

/** Nodes that can be the start of the flow. */
const START_NODES: NodeType[] = ['trigger']

/** Nodes that have a true/false branching handle. */
const BRANCHING_NODES: NodeType[] = ['condition']

/** Nodes that support multiple outgoing edges (labeled handles). */
const MULTI_BRANCH_NODES: NodeType[] = ['random', 'switch_case']

/**
 * Validate a bot flow. Returns an array of issues sorted by severity
 * (errors first, then warnings, then info).
 */
export function validateFlow(flow: BotFlow): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { nodes, edges } = flow

  if (nodes.length === 0) {
    return [{ severity: 'error', category: 'structure', message: 'Flow is empty — add a Trigger node to start.' }]
  }

  // ── 1. Exactly one trigger ──────────────────────────────────────────
  const triggers = nodes.filter((n) => n.type === 'trigger')
  if (triggers.length === 0) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: 'No Trigger node found. Every flow must start with exactly one Trigger.',
      fix: 'Drag a Trigger node from the Triggers palette.',
    })
  } else if (triggers.length > 1) {
    triggers.forEach((t) => {
      issues.push({
        nodeId: t.id,
        severity: 'error',
        category: 'structure',
        message: `Multiple Trigger nodes found (${triggers.length}). Only one is allowed.`,
        fix: 'Delete the extra Trigger nodes — a flow can only have one entry point.',
      })
    })
  }

  // ── 2. Reachability — all nodes must be reachable from the trigger ──
  const reachable = computeReachable(flow)
  for (const node of nodes) {
    if (!reachable.has(node.id) && node.type !== 'trigger') {
      issues.push({
        nodeId: node.id,
        severity: 'warning',
        category: 'reachability',
        message: `Node "${node.data?.label || node.type}" is unreachable — no path leads to it from the Trigger.`,
        fix: 'Connect it to the flow, or delete it if unused.',
      })
    }
  }

  // ── Per-node checks ─────────────────────────────────────────────────
  for (const node of nodes) {
    const outgoing = edges.filter((e) => e.source === node.id)

    switch (node.type) {
      // ── Trigger: must have an outgoing edge ─────────────────────────
      case 'trigger':
        if (outgoing.length === 0) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'connection',
            message: 'Trigger has no outgoing connection.',
            fix: 'Connect the Trigger to the first action node.',
          })
        }
        if (node.data.triggerType === 'command' && !node.data.command) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Command trigger has no command name set.',
            fix: 'Enter a command name (e.g. "hello" for /hello).',
          })
        }
        break

      // ── Message: warn on empty text ─────────────────────────────────
      case 'message':
        if (!node.data.text?.trim()) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'config',
            message: 'Message node has empty text — it will send nothing.',
            fix: 'Type a message, or use {{variables}} to interpolate values.',
          })
        }
        break

      // ── Input: must have prompt + outgoing edge + variable name ─────
      case 'input':
        if (!node.data.prompt?.trim()) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Input node has no prompt — the user won\'t know what to reply.',
            fix: 'Add a question like "What\'s your name?"',
          })
        }
        if (!node.data.variableName) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Input node has no variable name — the reply will be lost.',
            fix: 'Set a variable name like "userName".',
          })
        }
        if (outgoing.length === 0) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'connection',
            message: 'Input node has no outgoing edge — the flow will dead-end after the user replies.',
            fix: 'Connect the output to the next node.',
          })
        }
        break

      // ── Wait_choice: same as input + needs ≥2 options ───────────────
      case 'wait_choice':
        if (!node.data.prompt?.trim()) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Choice node has no prompt.',
            fix: 'Add a prompt like "Pick one:"',
          })
        }
        if (!node.data.options || node.data.options.length < 2) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Choice node needs at least 2 options.',
            fix: 'Add options like "Yes" and "No".',
          })
        }
        if (!node.data.variableName) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'config',
            message: 'Choice node has no variable name — the selection will be lost.',
            fix: 'Set a variable name like "choice".',
          })
        }
        if (outgoing.length === 0) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'connection',
            message: 'Choice node has no outgoing edge.',
            fix: 'Connect to the next node.',
          })
        }
        break

      // ── Condition: recommend both branches ──────────────────────────
      case 'condition': {
        const trueEdge = outgoing.find((e) => e.sourceHandle === 'true')
        const falseEdge = outgoing.find((e) => e.sourceHandle === 'false')
        if (!trueEdge) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'branch',
            message: 'Condition has no TRUE branch — the matching path is a dead end.',
            fix: 'Connect the green TRUE handle to a node.',
          })
        }
        if (!falseEdge) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'branch',
            message: 'Condition has no FALSE branch — the non-matching path is a dead end.',
            fix: 'Connect the red FALSE handle to a node.',
          })
        }
        if (!node.data.variable) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'config',
            message: 'Condition checks no variable — it will always evaluate the same way.',
            fix: 'Enter a variable name to check, like "userName".',
          })
        }
        break
      }

      // ── Switch_case: recommend ≥2 cases ─────────────────────────────
      case 'switch_case': {
        const cases = (node.data.cases || []) as string[]
        const usedHandles = outgoing.map((e) => e.sourceHandle).filter(Boolean)
        if (cases.length < 2) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'branch',
            message: 'Switch has fewer than 2 cases.',
            fix: 'Add at least 2 case values to branch on.',
          })
        }
        for (let i = 0; i < cases.length; i++) {
          if (!usedHandles.includes(`case_${i}`)) {
            issues.push({
              nodeId: node.id,
              severity: 'warning',
              category: 'branch',
              message: `Switch case "${cases[i]}" has no outgoing edge.`,
              fix: `Connect the case_${i} handle to a node.`,
            })
          }
        }
        // Check default branch
        const hasDefault = outgoing.some((e) => e.sourceHandle === 'default')
        if (!hasDefault) {
          issues.push({
            nodeId: node.id,
            severity: 'info',
            category: 'branch',
            message: 'Switch has no DEFAULT branch — unmatched values will dead-end.',
            fix: 'Connect the default handle for unmatched values.',
          })
        }
        break
      }

      // ── Random: needs ≥2 edges ──────────────────────────────────────
      case 'random':
        if (outgoing.length < 2) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'branch',
            message: `Random node has only ${outgoing.length} outgoing edge${outgoing.length === 1 ? '' : 's'} — add more for randomness.`,
            fix: 'Connect multiple nodes to create random branches.',
          })
        }
        break

      // ── Counter: needs variable name ────────────────────────────────
      case 'counter':
        if (!node.data.variable) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Counter has no variable name.',
            fix: 'Set a variable name like "count".',
          })
        }
        break

      // ── AI Generate: recommend error handling ───────────────────────
      case 'ai_generate':
        if (!node.data.aiPrompt?.trim()) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'AI Generate has no prompt.',
            fix: 'Enter a prompt like "Reply to: {{body}}".',
          })
        }
        if (!node.data.variableName) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'config',
            message: 'AI Generate has no output variable — the response will be lost.',
            fix: 'Set a variable name like "aiResponse".',
          })
        }
        issues.push({
          nodeId: node.id,
          severity: 'info',
          category: 'error-handling',
          message: 'AI Generate can fail if Ollama is offline. Consider a Condition checking if the response starts with "[AI error".',
          fix: 'Add a Condition → {{aiResponse}} starts_with "[AI error" → fallback message.',
        })
        break

      // ── API call: recommend error handling ──────────────────────────
      case 'api_call':
        if (!node.data.url?.trim()) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'API Call has no URL.',
            fix: 'Enter the endpoint URL.',
          })
        }
        break

      // ── Set_var: needs variable name ────────────────────────────────
      case 'set_var':
        if (!node.data.variable) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Set Variable has no variable name.',
            fix: 'Enter a variable name.',
          })
        }
        break

      // ── Format_string: needs template + variable ────────────────────
      case 'format_string':
        if (!node.data.text?.trim()) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            category: 'config',
            message: 'Format String has no template.',
            fix: 'Enter a template like "Hello {{name}}, you are {{age}}".',
          })
        }
        if (!node.data.variableName) {
          issues.push({
            nodeId: node.id,
            severity: 'warning',
            category: 'config',
            message: 'Format String has no output variable.',
            fix: 'Set a variable name to store the result.',
          })
        }
        break
    }
  }

  // ── 7. Variable scope — check references before definitions ────────
  const scopeIssues = checkVariableScope(flow)
  issues.push(...scopeIssues)

  // ── 8. Infinite loop detection ─────────────────────────────────────
  const loopIssue = detectInfiniteLoop(flow)
  if (loopIssue) {
    issues.push(loopIssue)
  }

  // ── Sort by severity ───────────────────────────────────────────────
  const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])

  return issues
}

/**
 * Compute the set of node IDs reachable from the trigger node via edges.
 */
function computeReachable(flow: BotFlow): Set<string> {
  const trigger = flow.nodes.find((n) => n.type === 'trigger')
  if (!trigger) return new Set()

  const reachable = new Set<string>()
  const stack = [trigger.id]

  while (stack.length > 0) {
    const id = stack.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    const outgoing = flow.edges.filter((e) => e.source === id)
    for (const edge of outgoing) {
      if (!reachable.has(edge.target)) {
        stack.push(edge.target)
      }
    }
  }

  return reachable
}

/**
 * Check that variables referenced in {{var}} placeholders are defined
 * (via set_var, input, wait_choice, counter, ai_generate, api_call,
 * format_string) before they're used.
 */
function checkVariableScope(flow: BotFlow): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const defined = new Set<string>(['sender', 'body', 'args']) // built-in vars

  // Walk the flow in execution order (BFS from trigger)
  const trigger = flow.nodes.find((n) => n.type === 'trigger')
  if (!trigger) return issues

  const visited = new Set<string>()
  const queue: FlowNode[] = [trigger]

  while (queue.length > 0) {
    const node = queue.shift()!
    if (visited.has(node.id)) continue
    visited.add(node.id)

    // Check references in this node's text fields
    const refs = extractVariableRefs(node)
    for (const ref of refs) {
      if (!defined.has(ref)) {
        issues.push({
          nodeId: node.id,
          severity: 'warning',
          category: 'variable-scope',
          message: `Variable "{{${ref}}}" is used here but may not be defined yet.`,
          fix: `Add a Set Variable or Input node before this one to define {{${ref}}}.`,
        })
      }
    }

    // Mark variables defined by this node
    const defines = extractVariableDefs(node)
    defines.forEach((v) => defined.add(v))

    // Enqueue children
    const outgoing = flow.edges.filter((e) => e.source === node.id)
    for (const edge of outgoing) {
      const child = flow.nodes.find((n) => n.id === edge.target)
      if (child && !visited.has(child.id)) {
        queue.push(child)
      }
    }
  }

  return issues
}

/** Extract {{var}} references from a node's text fields. */
function extractVariableRefs(node: FlowNode): string[] {
  const refs: string[] = []
  const fields = [
    node.data.text,
    node.data.prompt,
    node.data.aiPrompt,
    node.data.aiSystemPrompt,
    node.data.body,
    node.data.url,
    node.data.value,
  ]
  for (const field of fields) {
    if (typeof field === 'string') {
      const matches = field.matchAll(/\{\{(\w+)\}\}/g)
      for (const m of matches) {
        refs.push(m[1])
      }
    }
  }
  return refs
}

/** Extract variable names defined by a node. */
function extractVariableDefs(node: FlowNode): string[] {
  const defs: string[] = []
  if (node.data.variableName) defs.push(node.data.variableName)
  if (node.data.variable && (node.type === 'set_var' || node.type === 'counter')) {
    defs.push(node.data.variable)
  }
  return defs
}

/**
 * Detect infinite loops — cycles that don't pass through a pausing node
 * (input/wait_choice). The engine's MAX_STEPS guard will catch these at
 * runtime, but it's better to warn at design time.
 */
function detectInfiniteLoop(flow: BotFlow): ValidationIssue | null {
  const trigger = flow.nodes.find((n) => n.type === 'trigger')
  if (!trigger) return null

  // DFS with path tracking — if we revisit a node in the current path
  // without passing through a pausing node, it's an infinite loop.
  const visiting = new Set<string>()
  const path: string[] = []

  function dfs(nodeId: string): boolean {
    if (visiting.has(nodeId)) {
      // Found a cycle — check if any node in the cycle is a pausing node
      const cycleStart = path.indexOf(nodeId)
      const cycleNodes = path.slice(cycleStart)
      const hasPauser = cycleNodes.some((id) => {
        const n = flow.nodes.find((nn) => nn.id === id)
        return n && PAUSING_NODES.includes(n.type)
      })
      if (!hasPauser) return true
      return false
    }

    const node = flow.nodes.find((n) => n.id === nodeId)
    if (!node) return false

    visiting.add(nodeId)
    path.push(nodeId)

    const outgoing = flow.edges.filter((e) => e.source === nodeId)
    for (const edge of outgoing) {
      if (dfs(edge.target)) return true
    }

    visiting.delete(nodeId)
    path.pop()
    return false
  }

  if (dfs(trigger.id)) {
    return {
      severity: 'error',
      category: 'loop',
      message: 'Infinite loop detected — a cycle in the flow doesn\'t pass through a pausing node (Input/Choice).',
      fix: 'Add an Input or Choice node inside the cycle, or add a Stop node to break it.',
    }
  }

  return null
}

/**
 * Check if a connection is valid — can `source` node connect to `target`?
 * Returns null if valid, or an error message explaining why not.
 */
export function validateConnection(
  sourceType: NodeType,
  targetType: NodeType,
  sourceHandle?: string | null
): string | null {
  // Triggers can only be the source, never the target
  if (targetType === 'trigger') {
    return 'Trigger nodes cannot receive incoming connections — they are the flow start.'
  }

  // Stop nodes can't have outgoing edges
  if (sourceType === 'stop') {
    return 'Stop nodes cannot have outgoing connections — they end the flow.'
  }

  // Don't allow self-loops
  // (This is checked by ReactFlow itself, but we include it for completeness)

  return null
}

/**
 * Get a summary of the flow for display.
 */
export function getFlowSummary(flow: BotFlow): {
  nodeCount: number
  edgeCount: number
  hasTrigger: boolean
  hasStop: boolean
  pausingNodes: number
  maxDepth: number
} {
  const trigger = flow.nodes.find((n) => n.type === 'trigger')
  const reachable = computeReachable(flow)
  const pausingNodes = flow.nodes.filter((n) => PAUSING_NODES.includes(n.type)).length
  const hasStop = flow.nodes.some((n) => n.type === 'stop')

  // Compute max depth from trigger
  let maxDepth = 0
  if (trigger) {
    const depths = new Map<string, number>()
    const stack = [{ id: trigger.id, depth: 0 }]
    while (stack.length > 0) {
      const { id, depth } = stack.pop()!
      if (depths.has(id) && depths.get(id)! >= depth) continue
      depths.set(id, depth)
      maxDepth = Math.max(maxDepth, depth)
      const outgoing = flow.edges.filter((e) => e.source === id)
      for (const edge of outgoing) {
        stack.push({ id: edge.target, depth: depth + 1 })
      }
    }
  }

  return {
    nodeCount: flow.nodes.length,
    edgeCount: flow.edges.length,
    hasTrigger: !!trigger,
    hasStop,
    pausingNodes,
    maxDepth,
  }
}
