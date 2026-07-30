'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
  Handle,
  Position,
  MarkerType,
  SelectionMode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Zap, Send, Loader, Keyboard, MousePointerClick,
  GitBranch, Variable, Clock, Square, Webhook, Shuffle,
  Save, Trash2, Plus, X, AlertTriangle, Info, Sparkles,
  Image as ImageIcon, Split, Hash, Braces, Terminal,
  Bug, CheckCircle2, Play, ChevronRight, Activity,
  Download, Upload, FileText, AudioLines,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  type BotFlow, type FlowNode, type NodeType, type NodeCategory,
  NODE_DEFS, CATEGORY_ORDER, CATEGORY_LABELS, defaultNodeData,
} from '@/lib/bot/flow-types'
import { validateFlow, getFlowSummary, type ValidationIssue } from '@/lib/bot/flow-validation'
import { debugRunFlow, formatTraceEvent, type DebugResult, type MockInput } from '@/lib/bot/flow-debug'
import { EXAMPLE_BOT_FLOW } from '@/lib/bot/example-flow'
import { cn } from '@/lib/utils'

// ─── Icon registry ───────────────────────────────────────────────────────────
const ICONS: Record<string, typeof Zap> = {
  Zap, Send, Loader, Keyboard, MousePointerClick,
  GitBranch, Variable, Clock, Square, Webhook, Shuffle,
  Sparkles,
  Image: ImageIcon,
  Split, Hash, Braces, Terminal,
  AudioLines,
}

// ─── Custom Node Component ───────────────────────────────────────────────────
/**
 * Reads the FlowNode type from `data.type` (NOT the ReactFlow `type` prop,
 * which is always 'custom' in this app). This was the root cause of every
 * node rendering as a green "Send Message" node.
 */
function CustomNode({ data, selected }: { data: any; selected?: boolean }) {
  const nodeType = (data.type as NodeType) || 'message'
  const def = NODE_DEFS[nodeType] || NODE_DEFS.message
  const Icon = ICONS[def.icon] || Zap

  const isTrigger = nodeType === 'trigger'
  const isStop = nodeType === 'stop'
  const isCondition = nodeType === 'condition'
  const isRandom = nodeType === 'random'
  const isSwitch = nodeType === 'switch_case'

  // ── Build preview content per node type ──────────────────────────────
  let preview: { label: string; value: string } | null = null
  switch (nodeType) {
    case 'trigger': {
      const tt = data.triggerType || 'any_message'
      const label =
        tt === 'command' ? `/${data.command || 'command'}` :
        tt === 'mention' ? '@mentioned' :
        'any message'
      preview = { label: 'When', value: label }
      break
    }
    case 'message':
      preview = { label: 'Says', value: data.text || '(empty)' }
      break
    case 'typing':
      preview = { label: 'For', value: `${data.seconds || 1}s` }
      break
    case 'input':
      preview = { label: 'Asks', value: data.prompt || '(empty)' }
      break
    case 'wait_choice':
      preview = { label: 'Buttons', value: (data.options || []).join(' · ') || '(none)' }
      break
    case 'condition':
      preview = { label: 'If', value: `${data.variable || '∅'} ${data.operator || 'exists'} ${data.value || ''}` }
      break
    case 'set_var':
      preview = { label: 'Sets', value: `${data.variable || '∅'} = ${data.value || '∅'}` }
      break
    case 'delay':
      preview = { label: 'Wait', value: `${data.seconds || 1}s` }
      break
    case 'stop':
      preview = null
      break
    case 'api_call':
      preview = { label: 'Calls', value: `${data.method || 'GET'} ${data.url || '(no url)'}` }
      break
    case 'random':
      preview = { label: 'Picks', value: 'a random branch' }
      break
    case 'ai_generate':
      preview = { label: 'Asks AI', value: data.aiPrompt ? (data.aiPrompt.length > 40 ? data.aiPrompt.slice(0, 40) + '…' : data.aiPrompt) : '(no prompt)' }
      break
    case 'send_media':
      preview = { label: 'Sends', value: data.mediaUrl || '(no url)' }
      break
    case 'switch_case':
      preview = { label: 'Switch on', value: data.switchVariable || '(no var)' }
      break
    case 'counter':
      preview = { label: 'Incr', value: `${data.variable || 'count'} by ${data.increment ?? 1}` }
      break
    case 'format_string':
      preview = { label: 'Formats', value: data.text || '(no template)' }
      break
    case 'log':
      preview = { label: 'Logs', value: data.logMessage ? (data.logMessage.length > 40 ? data.logMessage.slice(0, 40) + '…' : data.logMessage) : '(no message)' }
      break
    case 'tts':
      preview = { label: 'Speaks', value: data.ttsText ? (data.ttsText.length > 40 ? data.ttsText.slice(0, 40) + '…' : data.ttsText) : '(no text)' }
      break
  }

  return (
    <div
      className="bg-[#2b2d31] rounded-xl min-w-[200px] max-w-[260px] shadow-lg border overflow-hidden transition-shadow"
      style={{
        borderColor: selected ? def.color : 'rgba(255,255,255,0.08)',
        boxShadow: selected ? `0 0 0 2px ${def.color}40` : undefined,
      }}
    >
      {/* Target handle (not for trigger — it has no incoming edges) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="adoo-handle"
          style={{ background: def.color, width: 16, height: 16, border: '3px solid #1e1f22', borderRadius: '50%' }}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ background: def.bg, borderColor: `${def.color}30` }}
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ background: def.color + '30' }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: def.color }} />
        </div>
        <span
          className="text-[11px] font-bold uppercase tracking-wider flex-1"
          style={{ color: def.color }}
        >
          {def.label}
        </span>
        {def.pauses && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/60">
            pause
          </span>
        )}
        {def.terminates && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/60">
            end
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 text-xs">
        {preview ? (
          <div className="space-y-1">
            <div className="text-white/40 uppercase tracking-wider text-[10px]">{preview.label}</div>
            <div className="text-white/80 break-words line-clamp-2">{preview.value}</div>
            {(nodeType === 'input' || nodeType === 'wait_choice' || nodeType === 'api_call') && data.variableName && (
              <div className="text-[10px] text-white/40">→ saves as <code className="text-white/60">{`{{${data.variableName}}}`}</code></div>
            )}
          </div>
        ) : (
          <div className="text-white/50 italic text-center py-1">{def.description}</div>
        )}
      </div>

      {/* Source handles */}
      {isCondition ? (
        <div className="flex justify-between px-3 pb-2 pt-1">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold text-emerald-400 mb-1">TRUE</span>
            <Handle
              type="source"
              position={Position.Bottom}
              id="true"
              className="adoo-handle"
              style={{ background: '#34D399', width: 16, height: 16, border: '3px solid #1e1f22', borderRadius: '50%' }}
            />
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold text-red-400 mb-1">FALSE</span>
            <Handle
              type="source"
              position={Position.Bottom}
              id="false"
              className="adoo-handle"
              style={{ background: '#F87171', width: 16, height: 16, border: '3px solid #1e1f22', borderRadius: '50%' }}
            />
          </div>
        </div>
      ) : isSwitch ? (
        <div className="px-3 pb-2 pt-1 space-y-1.5">
          {((data.cases as string[]) || []).map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-white/40 shrink-0 w-10">case_{i}</span>
              <span className="text-[10px] text-white/70 truncate flex-1 px-1.5 py-0.5 rounded bg-white/5">{c || `(empty)`}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`case_${i}`}
                className="adoo-handle"
                style={{ background: '#FB7185', width: 16, height: 16, border: '3px solid #1e1f22', borderRadius: '50%', position: 'relative' }}
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1.5 border-t border-white/10">
            <span className="text-[10px] font-mono text-white/40 shrink-0 w-10">default</span>
            <span className="text-[10px] text-white/40 italic flex-1 px-1.5 py-0.5 rounded bg-white/5">fallback</span>
            <Handle
              type="source"
              position={Position.Right}
              id="default"
              className="adoo-handle"
              style={{ background: '#64748B', width: 16, height: 16, border: '3px solid #1e1f22', borderRadius: '50%', position: 'relative' }}
            />
          </div>
        </div>
      ) : isRandom ? (
        <div className="px-3 pb-2 pt-1 text-center">
          <span className="text-[10px] text-white/40 mb-1 block">All outgoing edges are random picks</span>
          <Handle
            type="source"
            position={Position.Bottom}
            className="adoo-handle"
            style={{ background: def.color, width: 16, height: 16, border: '3px solid #1e1f22', borderRadius: '50%' }}
          />
        </div>
      ) : !isStop ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="adoo-handle"
          style={{ background: def.color, width: 16, height: 16, border: '3px solid #1e1f22', borderRadius: '50%' }}
        />
      ) : null}
    </div>
  )
}

const nodeTypes = { custom: CustomNode }

// ─── Bot Builder Editor ──────────────────────────────────────────────────────

interface BotBuilderEditorProps {
  initialFlow?: BotFlow
  onSave: (flow: BotFlow) => void
  bot?: any
}

export function BotBuilderEditor({ initialFlow, onSave, bot }: BotBuilderEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<'inspector' | 'issues' | 'debug'>('inspector')
  const [showShortcuts, setShowShortcuts] = useState(false)

  // ── Initial nodes/edges ──────────────────────────────────────────────
  // FIX: previously the .map() overwrote data.type with ReactFlow's type
  // ('custom'), so the inspector crashed on click. Now we use data.type
  // everywhere and never let n.type leak into data.
  const { initialNodes, initialEdges } = useMemo(() => {
    if (initialFlow?.nodes?.length) {
      return {
        initialNodes: initialFlow.nodes.map((n) => ({
          id: n.id,
          type: 'custom',
          position: n.position,
          data: { ...n.data },
        })) as Node[],
        initialEdges: initialFlow.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle || undefined,
          label: e.label || undefined,
          animated: true,
          style: { stroke: '#5865F2', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#5865F2' },
        })) as Edge[],
      }
    }
    // Brand-new bot: seed with a sensible default flow
    const triggerData = defaultNodeData('trigger')
    const msgData = defaultNodeData('message')
    return {
      initialNodes: [
        { id: 'trigger-1', type: 'custom', position: { x: 320, y: 80 }, data: { ...triggerData, type: 'trigger' } },
        { id: 'message-1', type: 'custom', position: { x: 320, y: 240 }, data: { ...msgData, type: 'message' } },
      ] as Node[],
      initialEdges: [
        {
          id: 'e-trigger-1-message-1',
          source: 'trigger-1',
          target: 'message-1',
          animated: true,
          style: { stroke: '#5865F2', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#5865F2' },
        },
      ] as Edge[],
    }
  }, [initialFlow])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: '#5865F2', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#5865F2' },
          },
          eds
        )
      ),
    [setEdges]
  )

  // ── Add node — position near the canvas center, offset by count ──────
  const addNode = (type: NodeType) => {
    const id = `${type}-${Date.now()}`
    const data = { ...defaultNodeData(type), type }
    // Place near the top-center with a slight cascade so it's always visible
    const idx = nodes.length
    const position = {
      x: 240 + (idx % 4) * 90,
      y: 80 + idx * 30,
    }
    setNodes((nds) => [...nds, { id, type: 'custom', position, data }])
    setSelectedNodeId(id)
  }

  const updateNodeData = (nodeId: string, patch: Record<string, any>) =>
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
    )

  const deleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedNodeId(null)
  }

  // Disconnect an edge — used by the edge context menu and the Delete key.
  const deleteEdge = (edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId))
    setSelectedEdgeId(null)
  }

  // ── Clipboard for copy/paste ─────────────────────────────────────────
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)

  // Get all currently selected nodes (supports multi-select)
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes])
  const selectedEdges = useMemo(
    () => edges.filter((e) => e.selected || (selectedNodeId && (e.source === selectedNodeId || e.target === selectedNodeId))),
    [edges, selectedNodeId]
  )

  // Duplicate selected nodes (Ctrl+D)
  const duplicateSelected = useCallback(() => {
    if (selectedNodes.length === 0) return
    const newNodes: Node[] = []
    const newEdges: Edge[] = []
    const idMap = new Map<string, string>()

    // Create copies of each selected node, offset by 40px
    for (const n of selectedNodes) {
      const newId = `${(n.data as any)?.type || 'node'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      idMap.set(n.id, newId)
      newNodes.push({
        ...n,
        id: newId,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: true,
        data: { ...n.data },
      })
    }

    // Copy edges between duplicated nodes
    for (const e of edges) {
      const newSource = idMap.get(e.source)
      const newTarget = idMap.get(e.target)
      if (newSource && newTarget) {
        newEdges.push({
          ...e,
          id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: newSource,
          target: newTarget,
          selected: false,
        })
      }
    }

    // Deselect original nodes, add the copies
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes])
    setEdges((eds) => [...eds, ...newEdges])
  }, [selectedNodes, edges, setNodes, setEdges])

  // Copy selected nodes to clipboard (Ctrl+C)
  const copySelected = useCallback(() => {
    if (selectedNodes.length === 0) return
    const connectedEdges = edges.filter((e) =>
      selectedNodes.some((n) => n.id === e.source) &&
      selectedNodes.some((n) => n.id === e.target)
    )
    clipboardRef.current = { nodes: selectedNodes, edges: connectedEdges }
    toast.success(`Copied ${selectedNodes.length} node${selectedNodes.length > 1 ? 's' : ''}`)
  }, [selectedNodes, edges])

  // Paste from clipboard (Ctrl+V)
  const paste = useCallback(() => {
    if (!clipboardRef.current || clipboardRef.current.nodes.length === 0) return
    const { nodes: clipNodes, edges: clipEdges } = clipboardRef.current
    const idMap = new Map<string, string>()
    const newNodes: Node[] = []
    const newEdges: Edge[] = []

    for (const n of clipNodes) {
      const newId = `${(n.data as any)?.type || 'node'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      idMap.set(n.id, newId)
      newNodes.push({
        ...n,
        id: newId,
        position: { x: n.position.x + 60, y: n.position.y + 60 },
        selected: true,
        data: { ...n.data },
      })
    }

    for (const e of clipEdges) {
      const newSource = idMap.get(e.source)
      const newTarget = idMap.get(e.target)
      if (newSource && newTarget) {
        newEdges.push({
          ...e,
          id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: newSource,
          target: newTarget,
          selected: false,
        })
      }
    }

    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes])
    setEdges((eds) => [...eds, ...newEdges])
    toast.success(`Pasted ${newNodes.length} node${newNodes.length > 1 ? 's' : ''}`)
  }, [clipboardRef, setNodes, setEdges])

  // Select all nodes (Ctrl+A)
  const selectAll = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: true })))
  }, [setNodes])

  // Delete all selected nodes (handles multi-select Delete)
  const deleteSelected = useCallback(() => {
    const toDelete = nodes.filter((n) => n.selected).map((n) => n.id)
    if (toDelete.length === 0) {
      if (selectedNodeId) deleteNode(selectedNodeId)
      else if (selectedEdgeId) deleteEdge(selectedEdgeId)
      return
    }
    setNodes((nds) => nds.filter((n) => !n.selected))
    setEdges((eds) => eds.filter((e) => !toDelete.includes(e.source) && !toDelete.includes(e.target)))
    setSelectedNodeId(null)
  }, [nodes, selectedNodeId, selectedEdgeId, setNodes, setEdges]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts: Delete, Ctrl+C/V/D/A
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't intercept if the user is typing in an input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      const mod = e.metaKey || e.ctrlKey

      // Ctrl/Cmd+C — copy
      if (mod && e.key === 'c' && !e.shiftKey) {
        // Let the browser handle text selection in inputs, but for canvas
        // we handle it ourselves
        if (selectedNodes.length > 0) {
          e.preventDefault()
          copySelected()
        }
        return
      }

      // Ctrl/Cmd+V — paste
      if (mod && e.key === 'v' && !e.shiftKey) {
        e.preventDefault()
        paste()
        return
      }

      // Ctrl/Cmd+D — duplicate
      if (mod && e.key === 'd') {
        e.preventDefault()
        duplicateSelected()
        return
      }

      // Ctrl/Cmd+A — select all
      if (mod && e.key === 'a') {
        e.preventDefault()
        selectAll()
        return
      }

      // Delete/Backspace — delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
        return
      }

      // Escape — deselect all
      if (e.key === 'Escape') {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })))
        setSelectedNodeId(null)
        setSelectedEdgeId(null)
        return
      }
    },
    [selectedNodes, selectedNodeId, selectedEdgeId, copySelected, paste, duplicateSelected, selectAll, deleteSelected] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const clearAll = () => {
    if (!confirm('Clear the entire flow? This cannot be undone.')) return
    setNodes([])
    setEdges([])
    setSelectedNodeId(null)
  }

  const handleSave = () => {
    const flow: BotFlow = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.type as NodeType,
        position: n.position,
        data: { ...n.data },
      })) as FlowNode[],
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || null,
        label: typeof e.label === 'string' ? e.label : undefined,
      })),
    }
    onSave(flow)
  }

  // ── Export flow as JSON file download ───────────────────────────────
  const handleExport = () => {
    const flow: BotFlow = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.type as NodeType,
        position: n.position,
        data: { ...n.data },
      })) as FlowNode[],
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || null,
        label: typeof e.label === 'string' ? e.label : undefined,
      })),
    }
    const json = JSON.stringify(flow, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bot-flow-${bot?.username || 'export'}-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Import flow from JSON file ──────────────────────────────────────
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const flow = JSON.parse(text) as BotFlow
        if (!flow.nodes || !flow.edges || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
          throw new Error('Invalid flow file: missing nodes or edges')
        }
        if (!confirm('Import this flow? It will replace the current canvas (you still need to Save to persist).')) return
        setNodes(flow.nodes.map((n) => ({
          id: n.id,
          type: 'custom',
          position: n.position,
          // Ensure data.type is set — use top-level type as fallback (for
          // exported flows that don't have type inside data)
          data: { ...n.data, type: n.data.type || n.type },
        })))
        setEdges(flow.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle || undefined,
          label: e.label || undefined,
          animated: true,
          style: { stroke: '#5865F2', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#5865F2' },
        })))
        setSelectedNodeId(null)
        toast.success(`Imported ${flow.nodes.length} nodes and ${flow.edges.length} edges`)
      } catch (err: any) {
        toast.error(`Import failed: ${err.message || 'invalid JSON'}`)
      }
    }
    input.click()
  }

  // ── Load example flow ───────────────────────────────────────────────
  const handleLoadExample = () => {
    if (!confirm('Load the example "Smart Assistant" bot? It will replace the current canvas (you still need to Save to persist).')) return
    const flow = EXAMPLE_BOT_FLOW
    setNodes(flow.nodes.map((n) => ({
      id: n.id,
      type: 'custom',
      position: n.position,
      data: { ...n.data },
    })))
    setEdges(flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || undefined,
      label: e.label || undefined,
      animated: true,
      style: { stroke: '#5865F2', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#5865F2' },
    })))
    setSelectedNodeId(null)
    toast.success('Loaded example bot — Save to persist it')
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null

  // ── Build current flow object (used by validation + debug) ──────────
  const currentFlow: BotFlow = useMemo(() => ({
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as any).type as NodeType,
      position: n.position,
      data: { ...n.data } as any,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || null,
      label: typeof e.label === 'string' ? e.label : undefined,
    })),
  }), [nodes, edges])

  // ── Validation ──────────────────────────────────────────────────────
  const validationIssues = useMemo(() => validateFlow(currentFlow), [currentFlow])
  const summary = useMemo(() => getFlowSummary(currentFlow), [currentFlow])
  const errorCount = validationIssues.filter((i) => i.severity === 'error').length
  const warningCount = validationIssues.filter((i) => i.severity === 'warning').length

  // Auto-switch to issues tab when there are errors and user hasn't selected a node
  useEffect(() => {
    if (errorCount > 0 && !selectedNodeId && rightTab === 'inspector') {
      setRightTab('issues')
    }
  }, [errorCount, selectedNodeId, rightTab])

  return (
    <div className="flex h-full bg-[#1e1f22]">
      {/* ─── LEFT: node palette ────────────────────────────────────────── */}
      <div className="w-56 shrink-0 bg-[#2b2d31] border-r border-white/5 flex flex-col">
        <div className="p-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-white/80">Flow Builder</h3>
          </div>
          <p className="text-[11px] text-white/40 mt-1">Drag or click a node to add it to the canvas.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {CATEGORY_ORDER.map((cat) => {
            const nodesInCat = Object.values(NODE_DEFS).filter((d) => d.category === cat)
            if (nodesInCat.length === 0) return null
            return (
              <div key={cat}>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2 px-1">
                  {CATEGORY_LABELS[cat]}
                </h4>
                <div className="space-y-1">
                  {nodesInCat.map((def) => {
                    const Icon = ICONS[def.icon] || Zap
                    return (
                      <button
                        key={def.type}
                        onClick={() => addNode(def.type)}
                        className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors text-left group"
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
                          style={{ background: def.bg }}
                        >
                          <Icon className="w-3.5 h-3.5" style={{ color: def.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white/80 font-medium">{def.label}</div>
                          <div className="text-[10px] text-white/30 truncate">{def.description}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-3 border-t border-white/5 space-y-2">
          <Button onClick={handleSave} className="w-full" size="sm">
            <Save className="w-4 h-4 mr-1.5" /> Save Flow
          </Button>

          {/* Export / Import / Example */}
          <div className="grid grid-cols-3 gap-1">
            <Button onClick={handleExport} variant="ghost" className="text-white/60 hover:text-white" size="sm" title="Export flow as JSON file">
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button onClick={handleImport} variant="ghost" className="text-white/60 hover:text-white" size="sm" title="Import flow from JSON file">
              <Upload className="w-3.5 h-3.5" />
            </Button>
            <Button onClick={handleLoadExample} variant="ghost" className="text-white/60 hover:text-white" size="sm" title="Load example bot">
              <FileText className="w-3.5 h-3.5" />
            </Button>
          </div>

          <Button onClick={clearAll} variant="ghost" className="w-full text-red-400 hover:text-red-300" size="sm">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear All
          </Button>
        </div>
      </div>

      {/* ─── CENTER: canvas ────────────────────────────────────────────── */}
      <div className="flex-1 relative flex flex-col">
        {/* Toolbar */}
        <div className="h-12 shrink-0 bg-[#2b2d31] border-b border-white/5 flex items-center px-4 gap-3">
          <span className="text-xs text-white/40">
            {nodes.length} node{nodes.length !== 1 ? 's' : ''} · {edges.length} edge{edges.length !== 1 ? 's' : ''}
          </span>
          {selectedEdgeId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-red-400 hover:text-red-300"
              onClick={() => deleteEdge(selectedEdgeId)}
            >
              <Trash2 className="w-3 h-3 mr-1" /> Disconnect
            </Button>
          )}
          {selectedNodeId && (
            <span className="text-xs text-white/40">
              Node selected — press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">Del</kbd> to remove
            </span>
          )}
          {/* Validation badge */}
          <button
            onClick={() => setRightTab('issues')}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors',
              errorCount > 0 ? 'bg-red-500/20 text-red-400' :
              warningCount > 0 ? 'bg-amber-500/20 text-amber-400' :
              'bg-emerald-500/20 text-emerald-400'
            )}
          >
            {errorCount > 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {errorCount > 0 ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` :
             warningCount > 0 ? `${warningCount} warning${warningCount !== 1 ? 's' : ''}` :
             'Valid'}
          </button>
          <div className="flex-1" />
          {/* Multi-select info */}
          {selectedNodes.length > 1 && (
            <span className="text-xs text-primary">
              {selectedNodes.length} nodes selected
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setRightTab('debug')}
          >
            <Bug className="w-3.5 h-3.5 mr-1" /> Test Run
          </Button>
          {/* Shortcuts help button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-white/40 hover:text-white/60"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Error strip — show only errors (not warnings) inline */}
        {errorCount > 0 && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2">
            <div className="flex items-start gap-2 text-xs text-red-300">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{validationIssues.filter((i) => i.severity === 'error')[0]?.message}</span>
            </div>
          </div>
        )}

        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges.map((e) => ({
              ...e,
              selected: e.id === selectedEdgeId,
              style: {
                stroke: e.id === selectedEdgeId ? '#EF4444' : '#5865F2',
                strokeWidth: e.id === selectedEdgeId ? 3 : 2,
              },
            }))}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
            }}
            onPaneClick={() => {
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
            }}
            onKeyDown={onKeyDown}
            nodeTypes={nodeTypes}
            fitView
            className="bg-[#1e1f22]"
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: '#5865F2', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#5865F2' },
            }}
            // Multi-select: Shift+drag on canvas creates a selection box.
            // Ctrl/Cmd+click adds nodes to the selection.
            selectionOnDrag
            panOnDrag={[1]}  // pan only with middle mouse button or right-click
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
            deleteKeyCode={null}  // we handle Delete ourselves in onKeyDown
            zoomOnScroll={true}
            panOnScroll={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ffffff10" />
            <Controls className="!bg-[#2b2d31] !border-white/10" />
            <MiniMap
              className="!bg-[#2b2d31] !border-white/10"
              nodeColor={(n) => {
                const t = (n.data as any)?.type as NodeType | undefined
                return t ? NODE_DEFS[t]?.color || '#5865F2' : '#5865F2'
              }}
              maskColor="rgba(0,0,0,0.5)"
            />
          </ReactFlow>
        </div>
      </div>

      {/* ─── RIGHT: tabbed panel (Inspector / Issues / Debug) ──────────── */}
      <div className="w-80 shrink-0 bg-[#2b2d31] border-l border-white/5 flex flex-col">
        {/* Tab bar */}
        <div className="shrink-0 flex border-b border-white/5">
          <button
            onClick={() => setRightTab('inspector')}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              rightTab === 'inspector' ? 'text-white border-b-2 border-primary bg-white/5' : 'text-white/40 hover:text-white/60'
            )}
          >
            Inspector
          </button>
          <button
            onClick={() => setRightTab('issues')}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
              rightTab === 'issues' ? 'text-white border-b-2 border-primary bg-white/5' : 'text-white/40 hover:text-white/60'
            )}
          >
            Issues
            {errorCount > 0 && <span className="bg-red-500/30 text-red-400 px-1.5 rounded-full text-[10px]">{errorCount}</span>}
            {warningCount > 0 && errorCount === 0 && <span className="bg-amber-500/30 text-amber-400 px-1.5 rounded-full text-[10px]">{warningCount}</span>}
          </button>
          <button
            onClick={() => setRightTab('debug')}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
              rightTab === 'debug' ? 'text-white border-b-2 border-primary bg-white/5' : 'text-white/40 hover:text-white/60'
            )}
          >
            <Bug className="w-3 h-3" /> Debug
          </button>
        </div>

        {/* Tab content */}
        {rightTab === 'inspector' && (
          selectedNode ? (
            <NodeInspectorPanel
              node={selectedNode}
              onUpdate={(patch) => updateNodeData(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
            />
          ) : (
            <EmptyInspector summary={summary} />
          )
        )}
        {rightTab === 'issues' && (
          <IssuesPanel issues={validationIssues} onSelectNode={(id) => { setSelectedNodeId(id); setRightTab('inspector') }} />
        )}
        {rightTab === 'debug' && (
          <DebugPanel flow={currentFlow} bot={bot} />
        )}
      </div>

      {/* Shortcuts help overlay */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-[#2b2d31] rounded-2xl border border-white/10 p-6 max-w-md w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white/80 flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-primary" /> Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-white/40 hover:text-white/60 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                { keys: ['Ctrl/Cmd', 'C'], desc: 'Copy selected nodes' },
                { keys: ['Ctrl/Cmd', 'V'], desc: 'Paste copied nodes' },
                { keys: ['Ctrl/Cmd', 'D'], desc: 'Duplicate selected nodes' },
                { keys: ['Ctrl/Cmd', 'A'], desc: 'Select all nodes' },
                { keys: ['Del', 'Backspace'], desc: 'Delete selected nodes/edges' },
                { keys: ['Esc'], desc: 'Deselect everything' },
                { keys: ['Shift', 'Drag'], desc: 'Box-select multiple nodes' },
                { keys: ['Ctrl/Cmd', 'Click'], desc: 'Add to selection' },
                { keys: ['Scroll'], desc: 'Zoom in/out' },
                { keys: ['Drag canvas'], desc: 'Pan (or use middle mouse)' },
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                  <span className="text-white/60">{s.desc}</span>
                  <div className="flex gap-1">
                    {s.keys.map((k, j) => (
                      <kbd key={j} className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] text-white/70 font-mono">
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Empty inspector state ───────────────────────────────────────────────────
function EmptyInspector({ summary }: { summary: ReturnType<typeof getFlowSummary> }) {
  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto">
      <h3 className="text-sm font-semibold text-white/80 mb-3">Flow Overview</h3>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-white/5 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Nodes</div>
          <div className="text-xl font-bold text-white/80">{summary.nodeCount}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Edges</div>
          <div className="text-xl font-bold text-white/80">{summary.edgeCount}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Max Depth</div>
          <div className="text-xl font-bold text-white/80">{summary.maxDepth}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Pausing</div>
          <div className="text-xl font-bold text-white/80">{summary.pausingNodes}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 text-xs">
        {summary.hasTrigger ? (
          <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Has trigger</span>
        ) : (
          <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> No trigger</span>
        )}
        {summary.hasStop ? (
          <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Has stop</span>
        ) : (
          <span className="text-white/30 flex items-center gap-1"><Info className="w-3 h-3" /> No stop</span>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-6">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
          <Info className="w-5 h-5 text-white/30" />
        </div>
        <p className="text-sm text-white/40 mb-2">No node selected</p>
        <p className="text-xs text-white/30 leading-relaxed">
          Click a node on the canvas to edit its settings, or click a node type on the left to add one.
        </p>
      </div>

      <div className="border-t border-white/5 pt-3 space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">Quick Tips</h4>
        <ul className="text-[11px] text-white/40 space-y-1.5 leading-relaxed">
          <li>• Every flow needs exactly one <span className="text-primary">Trigger</span> node.</li>
          <li>• <span className="text-red-400">Input</span> nodes pause the bot and wait for the user's next message.</li>
          <li>• Use <code className="text-white/60">{`{{varName}}`}</code> in text to insert variables.</li>
          <li>• <span className="text-amber-400">Condition</span> nodes have two outputs: TRUE and FALSE.</li>
          <li>• <span className="text-purple-400">AI Generate</span> calls your local Ollama LLM.</li>
          <li>• Use <Bug className="w-3 h-3 inline" /> Test Run to debug without saving.</li>
        </ul>
      </div>
    </div>
  )
}

// ─── Issues Panel ────────────────────────────────────────────────────────────
function IssuesPanel({
  issues,
  onSelectNode,
}: {
  issues: ValidationIssue[]
  onSelectNode: (nodeId: string) => void
}) {
  if (issues.length === 0) {
    return (
      <div className="p-4 flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
          <p className="text-sm text-white/60 font-medium">No issues found</p>
          <p className="text-xs text-white/30 mt-1">Your flow looks good! Run a test to verify behavior.</p>
        </div>
      </div>
    )
  }

  const severityConfig = {
    error: { color: '#F87171', bg: '#F871711A', icon: AlertTriangle, label: 'Error' },
    warning: { color: '#FBBF24', bg: '#FBBF241A', icon: AlertTriangle, label: 'Warning' },
    info: { color: '#60A5FA', bg: '#60A5FA1A', icon: Info, label: 'Info' },
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {issues.map((issue, i) => {
        const cfg = severityConfig[issue.severity]
        const Icon = cfg.icon
        return (
          <button
            key={i}
            onClick={() => issue.nodeId && onSelectNode(issue.nodeId)}
            disabled={!issue.nodeId}
            className={cn(
              'w-full text-left p-3 rounded-lg border transition-colors',
              issue.nodeId ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'
            )}
            style={{ borderColor: `${cfg.color}30`, background: cfg.bg }}
          >
            <div className="flex items-start gap-2">
              <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: cfg.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span className="text-[10px] text-white/30">·</span>
                  <span className="text-[10px] text-white/40">{issue.category}</span>
                </div>
                <p className="text-xs text-white/80 leading-relaxed">{issue.message}</p>
                {issue.fix && (
                  <p className="text-[11px] text-white/40 mt-1 italic">→ {issue.fix}</p>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Debug Panel (Test Run) ──────────────────────────────────────────────────
function DebugPanel({ flow, bot }: { flow: BotFlow; bot?: any }) {
  const [mockBody, setMockBody] = useState('Hello bot!')
  const [mockSender, setMockSender] = useState('TestUser')
  const [mockCommand, setMockCommand] = useState('')
  const [mockMention, setMockMention] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DebugResult | null>(null)

  const handleRun = async () => {
    setRunning(true)
    setResult(null)
    try {
      const input: MockInput = {
        body: mockBody,
        senderName: mockSender,
        command: mockCommand || undefined,
        isMention: mockMention,
        args: mockCommand ? mockBody.split(/\s+/) : [],
      }
      const res = await debugRunFlow(flow, input)
      setResult(res)
    } catch (e: any) {
      console.error('[debug] run failed:', e)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white/80 mb-1 flex items-center gap-2">
          <Bug className="w-4 h-4 text-primary" /> Test Run
        </h3>
        <p className="text-[11px] text-white/40">Simulate a message and trace the flow execution. No DB writes.</p>
      </div>

      {/* Mock input form */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-white/60 text-xs">Sender name</Label>
          <Input
            value={mockSender}
            onChange={(e) => setMockSender(e.target.value)}
            className="bg-[#1e1f22] border-white/10 text-white text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-white/60 text-xs">Message body</Label>
          <Textarea
            value={mockBody}
            onChange={(e) => setMockBody(e.target.value)}
            rows={2}
            className="bg-[#1e1f22] border-white/10 text-white text-xs resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-white/60 text-xs">Command (optional)</Label>
            <Input
              value={mockCommand}
              onChange={(e) => setMockCommand(e.target.value.replace(/^\//, ''))}
              placeholder="hello"
              className="bg-[#1e1f22] border-white/10 text-white text-xs font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-white/60 text-xs">Mentioned</Label>
            <button
              onClick={() => setMockMention(!mockMention)}
              className={cn(
                'w-full h-9 rounded-md border text-xs transition-colors',
                mockMention ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-[#1e1f22] border-white/10 text-white/40'
              )}
            >
              {mockMention ? '@mentioned' : 'not mentioned'}
            </button>
          </div>
        </div>
      </div>

      <Button onClick={handleRun} disabled={running} size="sm" className="w-full">
        {running ? (
          <><Loader className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Running…</>
        ) : (
          <><Play className="w-3.5 h-3.5 mr-1.5" /> Run Test</>
        )}
      </Button>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/5 rounded-lg p-2 text-center">
              <div className="text-[10px] uppercase text-white/40">Messages</div>
              <div className="text-lg font-bold text-emerald-400">{result.messages.length}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2 text-center">
              <div className="text-[10px] uppercase text-white/40">Steps</div>
              <div className="text-lg font-bold text-white/80">{result.trace?.filter((t) => t.type === 'node_enter').length || 0}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2 text-center">
              <div className="text-[10px] uppercase text-white/40">Errors</div>
              <div className="text-lg font-bold text-red-400">{result.trace?.filter((t) => t.type === 'error').length || 0}</div>
            </div>
          </div>

          {/* Status */}
          {result.paused && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-xs text-amber-300 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" /> Flow paused — waiting for user reply
            </div>
          )}
          {result.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-xs text-red-300">
              {result.error}
            </div>
          )}

          {/* Messages sent */}
          {result.messages.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">Bot Messages</h4>
              <div className="space-y-1.5">
                {result.messages.map((msg, i) => (
                  <div key={i} className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-xs text-white/80">
                    {msg}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Variables */}
          {Object.keys(result.variables).length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">Final Variables</h4>
              <div className="bg-[#1e1f22] rounded-lg p-2 space-y-1">
                {Object.entries(result.variables).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <code className="text-primary shrink-0">{`{{${k}}}`}</code>
                    <span className="text-white/30">=</span>
                    <span className="text-white/70 truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trace */}
          {result.trace && result.trace.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">Execution Trace</h4>
              <div className="bg-[#1e1f22] rounded-lg p-2 max-h-64 overflow-y-auto space-y-0.5">
                {result.trace.map((event, i) => (
                  <div key={i} className="text-[10px] text-white/50 font-mono leading-relaxed">
                    {formatTraceEvent(event, flow)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Inspector wrapper (header + delete button) ──────────────────────────────
function NodeInspectorPanel({
  node,
  onUpdate,
  onDelete,
}: {
  node: Node
  onUpdate: (patch: Record<string, any>) => void
  onDelete: () => void
}) {
  const nodeType = (node.data.type as NodeType) || 'message'
  const def = NODE_DEFS[nodeType] || NODE_DEFS.message
  const Icon = ICONS[def.icon] || Zap

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-white/5 flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: def.bg }}
        >
          <Icon className="w-4 h-4" style={{ color: def.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white/80 truncate">{def.label}</h3>
          <p className="text-[10px] text-white/40 truncate">{def.description}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-400 hover:text-red-300 shrink-0"
          onClick={onDelete}
          title="Delete node"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <NodeInspectorBody nodeType={nodeType} data={node.data} onUpdate={onUpdate} />
      </div>
    </div>
  )
}

// ─── Inspector body — per node type ──────────────────────────────────────────
function NodeInspectorBody({
  nodeType,
  data,
  onUpdate,
}: {
  nodeType: NodeType
  data: any
  onUpdate: (patch: Record<string, any>) => void
}) {
  const inputCls = 'bg-[#1e1f22] border-white/10 text-white placeholder:text-white/30'

  // ── TRIGGER ──────────────────────────────────────────────────────────
  if (nodeType === 'trigger') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">When should the bot start?</Label>
          <Select value={data.triggerType || 'any_message'} onValueChange={(v) => onUpdate({ triggerType: v })}>
            <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any_message">Any message in channel</SelectItem>
              <SelectItem value="command">Specific command</SelectItem>
              <SelectItem value="mention">When @mentioned</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {data.triggerType === 'command' && (
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Command name</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">/</span>
              <Input
                value={data.command || ''}
                onChange={(e) => onUpdate({ command: e.target.value.replace(/[^a-z0-9_]/gi, '') })}
                placeholder="hello"
                className={inputCls + ' pl-7'}
              />
            </div>
            <p className="text-xs text-white/40">Users type this to trigger the bot.</p>
          </div>
        )}
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-xs text-white/60">
          <p className="font-semibold text-primary mb-1">How triggers work</p>
          <p>The trigger node is the start of every flow. The bot will only respond when the trigger condition matches.</p>
        </div>
      </div>
    )
  }

  // ── MESSAGE ──────────────────────────────────────────────────────────
  if (nodeType === 'message') {
    return (
      <div className="space-y-2">
        <Label className="text-white/60 text-xs">Message text</Label>
        <Textarea
          value={data.text || ''}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="Hello {{sender}}! You said: {{body}}"
          rows={5}
          className={inputCls + ' resize-none'}
        />
        <VariableHelp />
      </div>
    )
  }

  // ── TYPING ───────────────────────────────────────────────────────────
  if (nodeType === 'typing') {
    return (
      <div className="space-y-2">
        <Label className="text-white/60 text-xs">Duration (seconds)</Label>
        <Input
          type="number"
          value={data.seconds || 1}
          onChange={(e) => onUpdate({ seconds: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)) })}
          min={1}
          max={30}
          className={inputCls}
        />
        <p className="text-xs text-white/40">Pauses the bot to make replies feel more natural.</p>
      </div>
    )
  }

  // ── INPUT ────────────────────────────────────────────────────────────
  if (nodeType === 'input') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Question / Prompt</Label>
          <Textarea
            value={data.prompt || ''}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="What's your name?"
            rows={2}
            className={inputCls + ' resize-none'}
          />
        </div>
        <VariableNameField
          value={data.variableName || ''}
          onChange={(v) => onUpdate({ variableName: v })}
          label="Save reply as variable"
          placeholder="userName"
        />
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-white/60">
          <p className="font-semibold text-red-400 mb-1">Pauses the flow</p>
          <p>The bot will send the prompt and wait for the user's next message. That message will be stored as <code className="text-white/80">{`{{${data.variableName || 'varName'}}}`}</code> and the flow will resume.</p>
        </div>
      </div>
    )
  }

  // ── WAIT_CHOICE ──────────────────────────────────────────────────────
  if (nodeType === 'wait_choice') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Prompt</Label>
          <Textarea
            value={data.prompt || ''}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="Pick one:"
            rows={2}
            className={inputCls + ' resize-none'}
          />
        </div>
        <OptionsEditor
          options={data.options || []}
          onChange={(options) => onUpdate({ options })}
        />
        <VariableNameField
          value={data.variableName || ''}
          onChange={(v) => onUpdate({ variableName: v })}
          label="Save picked choice as"
          placeholder="choice"
        />
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-white/60">
          <p className="font-semibold text-orange-400 mb-1">Inline buttons (Telegram-style)</p>
          <p>Each option becomes a tappable button under the message. The user can click a button OR type the option text. The picked value is stored as <code className="text-white/80">{`{{${data.variableName || 'choice'}}}`}</code>.</p>
        </div>
      </div>
    )
  }

  // ── CONDITION ────────────────────────────────────────────────────────
  if (nodeType === 'condition') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Variable to check</Label>
          <Input
            value={data.variable || ''}
            onChange={(e) => onUpdate({ variable: e.target.value })}
            placeholder="userName"
            className={inputCls}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Operator</Label>
          <Select value={data.operator || 'exists'} onValueChange={(v) => onUpdate({ operator: v })}>
            <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="equals">Equals (==)</SelectItem>
              <SelectItem value="not_equals">Not equals (!=)</SelectItem>
              <SelectItem value="contains">Contains</SelectItem>
              <SelectItem value="starts_with">Starts with</SelectItem>
              <SelectItem value="exists">Has any value</SelectItem>
              <SelectItem value="not_exists">Is empty / not set</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(data.operator === 'equals' || data.operator === 'not_equals' || data.operator === 'contains' || data.operator === 'starts_with') && (
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Compare with</Label>
            <Input
              value={data.value || ''}
              onChange={(e) => onUpdate({ value: e.target.value })}
              placeholder="yes"
              className={inputCls}
            />
          </div>
        )}
        <div className="bg-white/5 rounded-lg p-3 text-xs text-white/50 space-y-1">
          <p>Connect the <span className="text-emerald-400 font-semibold">TRUE</span> handle for the matching path.</p>
          <p>Connect the <span className="text-red-400 font-semibold">FALSE</span> handle for the non-matching path.</p>
        </div>
      </div>
    )
  }

  // ── SET_VAR ──────────────────────────────────────────────────────────
  if (nodeType === 'set_var') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Variable name</Label>
          <Input
            value={data.variable || ''}
            onChange={(e) => onUpdate({ variable: e.target.value })}
            placeholder="greetingCount"
            className={inputCls}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Value</Label>
          <Input
            value={data.value || ''}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="1"
            className={inputCls}
          />
          <p className="text-xs text-white/40">Supports <code className="text-white/60">{`{{varName}}`}</code> interpolation.</p>
        </div>
      </div>
    )
  }

  // ── DELAY ────────────────────────────────────────────────────────────
  if (nodeType === 'delay') {
    return (
      <div className="space-y-2">
        <Label className="text-white/60 text-xs">Wait time (seconds)</Label>
        <Input
          type="number"
          value={data.seconds || 1}
          onChange={(e) => onUpdate({ seconds: Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)) })}
          min={1}
          max={60}
          className={inputCls}
        />
        <p className="text-xs text-white/40">Pauses the bot for this many seconds before continuing.</p>
      </div>
    )
  }

  // ── STOP ─────────────────────────────────────────────────────────────
  if (nodeType === 'stop') {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
        <Square className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-white/70 font-medium">Ends the flow immediately</p>
        <p className="text-xs text-white/40 mt-1">No further nodes will execute.</p>
      </div>
    )
  }

  // ── API_CALL ─────────────────────────────────────────────────────────
  if (nodeType === 'api_call') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">URL</Label>
          <Input
            value={data.url || ''}
            onChange={(e) => onUpdate({ url: e.target.value })}
            placeholder="https://api.example.com/data"
            className={inputCls}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Method</Label>
          <Select value={data.method || 'GET'} onValueChange={(v) => onUpdate({ method: v })}>
            <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Headers (JSON)</Label>
          <Textarea
            value={data.headers || ''}
            onChange={(e) => onUpdate({ headers: e.target.value })}
            placeholder='{"Authorization": "Bearer xxx"}'
            rows={2}
            className={inputCls + ' resize-none font-mono text-xs'}
          />
        </div>
        {data.method === 'POST' && (
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Body</Label>
            <Textarea
              value={data.body || ''}
              onChange={(e) => onUpdate({ body: e.target.value })}
              placeholder='{"key": "value"}'
              rows={3}
              className={inputCls + ' resize-none font-mono text-xs'}
            />
          </div>
        )}
        <VariableNameField
          value={data.variableName || ''}
          onChange={(v) => onUpdate({ variableName: v })}
          label="Save response body as"
          placeholder="apiResult"
        />
      </div>
    )
  }

  // ── RANDOM ───────────────────────────────────────────────────────────
  if (nodeType === 'random') {
    return (
      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-4">
        <Shuffle className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
        <p className="text-sm text-white/70 font-medium text-center">Picks a random outgoing edge</p>
        <p className="text-xs text-white/40 mt-2 text-center leading-relaxed">
          Connect multiple nodes from this one. Each time the flow runs, exactly one will be chosen at random.
        </p>
      </div>
    )
  }

  // ── AI_GENERATE ──────────────────────────────────────────────────────
  if (nodeType === 'ai_generate') {
    return <AiGenerateInspector data={data} onUpdate={onUpdate} />
  }

  // ── SEND_MEDIA ───────────────────────────────────────────────────────
  if (nodeType === 'send_media') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Media URL</Label>
          <Input
            value={data.mediaUrl || ''}
            onChange={(e) => onUpdate({ mediaUrl: e.target.value })}
            placeholder="/api/uploads/photo.jpg or https://…"
            className={inputCls + ' font-mono text-xs'}
          />
          <p className="text-xs text-white/40">Upload via the chat composer first, then paste the URL here.</p>
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Media type</Label>
          <Select value={data.mediaType || 'image'} onValueChange={(v) => onUpdate({ mediaType: v })}>
            <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Caption (optional)</Label>
          <Textarea
            value={data.caption || ''}
            onChange={(e) => onUpdate({ caption: e.target.value })}
            placeholder="Check this out, {{sender}}!"
            rows={2}
            className={inputCls + ' resize-none'}
          />
          <VariableHelp />
        </div>
      </div>
    )
  }

  // ── SWITCH_CASE ──────────────────────────────────────────────────────
  if (nodeType === 'switch_case') {
    return <SwitchCaseInspector data={data} onUpdate={onUpdate} />
  }

  // ── COUNTER ──────────────────────────────────────────────────────────
  if (nodeType === 'counter') {
    return (
      <div className="space-y-4">
        <VariableNameField
          value={data.variable || ''}
          onChange={(v) => onUpdate({ variable: v })}
          label="Counter variable"
          placeholder="count"
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Increment by</Label>
            <Input
              type="number"
              value={data.increment ?? 1}
              onChange={(e) => onUpdate({ increment: parseInt(e.target.value, 10) || 1 })}
              className={inputCls}
            />
            <p className="text-xs text-white/40">Use negative to decrement</p>
          </div>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Start value</Label>
            <Input
              type="number"
              value={data.startValue ?? 0}
              onChange={(e) => onUpdate({ startValue: parseInt(e.target.value, 10) || 0 })}
              className={inputCls}
            />
            <p className="text-xs text-white/40">Used if var is unset</p>
          </div>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-white/60">
          <p className="font-semibold text-amber-400 mb-1">Counter</p>
          <p>Increments <code className="text-white/80">{`{{${data.variable || 'count'}}}`}</code> by {data.increment ?? 1} each time this node runs. If the variable doesn't exist yet, it starts at {data.startValue ?? 0}.</p>
        </div>
      </div>
    )
  }

  // ── FORMAT_STRING ────────────────────────────────────────────────────
  if (nodeType === 'format_string') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Template</Label>
          <Textarea
            value={data.text || ''}
            onChange={(e) => onUpdate({ text: e.target.value })}
            placeholder="Hello {{name}}, you have {{count}} messages"
            rows={3}
            className={inputCls + ' resize-none'}
          />
          <VariableHelp />
        </div>
        <VariableNameField
          value={data.variableName || ''}
          onChange={(v) => onUpdate({ variableName: v })}
          label="Save result as"
          placeholder="formatted"
        />
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-xs text-white/60">
          <p className="font-semibold text-indigo-400 mb-1">Format String</p>
          <p>Builds a string by interpolating <code className="text-white/80">{`{{variables}}`}</code> into a template. Useful for composing messages before sending them.</p>
        </div>
      </div>
    )
  }

  // ── LOG ──────────────────────────────────────────────────────────────
  if (nodeType === 'log') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Log message</Label>
          <Textarea
            value={data.logMessage || ''}
            onChange={(e) => onUpdate({ logMessage: e.target.value })}
            placeholder="Debug: user={{sender}} body={{body}}"
            rows={3}
            className={inputCls + ' resize-none font-mono text-xs'}
          />
          <VariableHelp />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Level</Label>
          <Select value={data.logLevel || 'info'} onValueChange={(v) => onUpdate({ logLevel: v })}>
            <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="bg-slate-500/10 border border-slate-500/20 rounded-lg p-3 text-xs text-white/60">
          <p className="font-semibold text-slate-400 mb-1">Log Node</p>
          <p>Doesn't send anything to the user — only shows in the <Bug className="w-3 h-3 inline" /> Debug trace. Use it to inspect variable values during a test run.</p>
        </div>
      </div>
    )
  }

  // ── TTS ─────────────────────────────────────────────────────────────
  if (nodeType === 'tts') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Text to speak</Label>
          <Textarea
            value={data.ttsText || ''}
            onChange={(e) => onUpdate({ ttsText: e.target.value })}
            placeholder="Hello {{sender}}! This is a voice message."
            rows={4}
            className={inputCls + ' resize-none'}
          />
          <VariableHelp />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Voice</Label>
          <Select value={data.ttsVoice || 'alba'} onValueChange={(v) => onUpdate({ ttsVoice: v })}>
            <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="alba">Alba (English, female)</SelectItem>
              <SelectItem value="charles">Charles (English, male)</SelectItem>
              <SelectItem value="jane">Jane (English, female)</SelectItem>
              <SelectItem value="michael">Michael (English, male)</SelectItem>
              <SelectItem value="vera">Vera (English, female)</SelectItem>
              <SelectItem value="george">George (English, male)</SelectItem>
              <SelectItem value="paul">Paul (English, male)</SelectItem>
              <SelectItem value="estelle">Estelle (French, female)</SelectItem>
              <SelectItem value="giovanni">Giovanni (Italian, male)</SelectItem>
              <SelectItem value="juergen">Juergen (German, male)</SelectItem>
              <SelectItem value="lola">Lola (Spanish, female)</SelectItem>
              <SelectItem value="rafael">Rafael (Portuguese, male)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-white/40">Built-in Pocket TTS voices. Custom voice IDs can be typed but require the voice to exist in the DB.</p>
        </div>
        <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg p-3 text-xs text-white/60">
          <p className="font-semibold text-pink-400 mb-1 flex items-center gap-1.5">
            <AudioLines className="w-3.5 h-3.5" /> Voice Message
          </p>
          <p>Generates audio using your local Pocket TTS server (TTS_URL) and sends it as a voice message. If TTS fails, falls back to sending the text as a plain message with a 🔊 prefix.</p>
        </div>
      </div>
    )
  }

  return null
}

// ─── Switch Case inspector ───────────────────────────────────────────────────
function SwitchCaseInspector({
  data,
  onUpdate,
}: {
  data: any
  onUpdate: (patch: Record<string, any>) => void
}) {
  const inputCls = 'bg-[#1e1f22] border-white/10 text-white placeholder:text-white/30'
  const cases: string[] = data.cases || []

  const addCase = () => {
    onUpdate({ cases: [...cases, ''] })
  }
  const updateCase = (i: number, value: string) => {
    const next = [...cases]
    next[i] = value
    onUpdate({ cases: next })
  }
  const removeCase = (i: number) => {
    onUpdate({ cases: cases.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="space-y-4">
      <VariableNameField
        value={data.switchVariable || ''}
        onChange={(v) => onUpdate({ switchVariable: v })}
        label="Variable to switch on"
        placeholder="choice"
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-white/60 text-xs">Cases ({cases.length})</Label>
          <Button onClick={addCase} variant="ghost" size="sm" className="h-6 text-xs">
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>
        <div className="space-y-1.5">
          {cases.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/40 font-mono shrink-0 w-12">case_{i}</span>
              <Input
                value={c}
                onChange={(e) => updateCase(i, e.target.value)}
                placeholder="value to match"
                className={inputCls + ' text-xs flex-1'}
              />
              <button
                onClick={() => removeCase(i)}
                className="text-red-400 hover:text-red-300 p-1 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-white/40">
          Each case gets its own output handle. Connect them to different branches. Unmatched values go to the <code className="text-white/60">default</code> handle.
        </p>
      </div>
      <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-xs text-white/60">
        <p className="font-semibold text-rose-400 mb-1">Switch</p>
        <p>Reads <code className="text-white/80">{`{{${data.switchVariable || 'var'}}}`}</code> and follows the matching case handle. If none match, follows the default handle.</p>
      </div>
    </div>
  )
}

// ─── AI Generate inspector (separate component — uses useQuery) ──────────────
function AiGenerateInspector({
  data,
  onUpdate,
}: {
  data: any
  onUpdate: (patch: Record<string, any>) => void
}) {
  const inputCls = 'bg-[#1e1f22] border-white/10 text-white placeholder:text-white/30'

  // Fetch available Ollama models (3s timeout handled server-side)
  const { data: modelsData, isLoading } = useQuery({
    queryKey: ['ollama-models'],
    queryFn: async () => {
      const res = await fetch('/api/llm/models')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    staleTime: 60_000, // models don't change often
  })
  const models: { name: string; details?: any }[] = modelsData?.models || []
  const online: boolean = modelsData?.online ?? false

  return (
    <div className="space-y-4">
      {/* Model picker */}
      <div className="space-y-2">
        <Label className="text-white/60 text-xs">Model</Label>
        {online ? (
          <Select
            value={data.aiModel || 'gemma3:270m'}
            onValueChange={(v) => onUpdate({ aiModel: v })}
          >
            <SelectTrigger className={inputCls}>
              <SelectValue placeholder={isLoading ? 'Loading…' : 'Select model'} />
            </SelectTrigger>
            <SelectContent>
              {models.length === 0 && !isLoading ? (
                <SelectItem value={data.aiModel || 'gemma3:270m'} disabled>
                  No models found — run `ollama pull gemma3:270m`
                </SelectItem>
              ) : (
                models.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name}
                    {m.details?.parameterSize ? (
                      <span className="text-white/40 ml-2 text-xs">({m.details.parameterSize})</span>
                    ) : null}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        ) : (
          <div className="space-y-1.5">
            <Input
              value={data.aiModel || ''}
              onChange={(e) => onUpdate({ aiModel: e.target.value })}
              placeholder="gemma3:270m"
              className={inputCls + ' font-mono'}
            />
            <p className="text-xs text-amber-400/80 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Ollama offline — using manual model name
            </p>
          </div>
        )}
        <p className="text-xs text-white/40">
          Local model from <code className="text-white/60">ollama pull &lt;name&gt;</code>
        </p>
      </div>

      {/* System prompt */}
      <div className="space-y-2">
        <Label className="text-white/60 text-xs">System prompt (optional)</Label>
        <Textarea
          value={data.aiSystemPrompt || ''}
          onChange={(e) => onUpdate({ aiSystemPrompt: e.target.value })}
          placeholder="You are a helpful assistant. Reply concisely."
          rows={2}
          className={inputCls + ' resize-none'}
        />
        <p className="text-xs text-white/40">Sets the AI's persona / behavior. Supports {`{{vars}}`}.</p>
      </div>

      {/* Prompt */}
      <div className="space-y-2">
        <Label className="text-white/60 text-xs">Prompt</Label>
        <Textarea
          value={data.aiPrompt || ''}
          onChange={(e) => onUpdate({ aiPrompt: e.target.value })}
          placeholder="Summarize this message in one sentence: {{body}}"
          rows={4}
          className={inputCls + ' resize-none'}
        />
        <VariableHelp />
      </div>

      {/* Temperature + Max tokens */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Temperature</Label>
          <Input
            type="number"
            value={data.aiTemperature ?? 0.7}
            onChange={(e) => onUpdate({ aiTemperature: Math.max(0, Math.min(2, parseFloat(e.target.value) || 0.7)) })}
            min={0}
            max={2}
            step={0.1}
            className={inputCls}
          />
          <p className="text-xs text-white/40">0 = precise, 1 = creative</p>
        </div>
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Max tokens</Label>
          <Input
            type="number"
            value={data.aiMaxTokens ?? 256}
            onChange={(e) => onUpdate({ aiMaxTokens: Math.max(16, Math.min(4096, parseInt(e.target.value, 10) || 256)) })}
            min={16}
            max={4096}
            step={16}
            className={inputCls}
          />
          <p className="text-xs text-white/40">Response length cap</p>
        </div>
      </div>

      {/* Output variable */}
      <VariableNameField
        value={data.variableName || ''}
        onChange={(v) => onUpdate({ variableName: v })}
        label="Save AI response as"
        placeholder="aiResponse"
      />

      {/* Tip */}
      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-xs text-white/60">
        <p className="font-semibold text-purple-400 mb-1 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          AI Generate
        </p>
        <p className="leading-relaxed">
          Calls your local Ollama instance. The generated text is stored as{' '}
          <code className="text-white/80">{`{{${data.variableName || 'aiResponse'}}}`}</code>{' '}
          — pipe it into a Send Message node with{' '}
          <code className="text-white/80">{`{{${data.variableName || 'aiResponse'}}}`}</code>{' '}
          to reply to the user.
        </p>
      </div>
    </div>
  )
}

// ─── Helper UI components ────────────────────────────────────────────────────

function VariableNameField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder: string
}) {
  const inputCls = 'bg-[#1e1f22] border-white/10 text-white placeholder:text-white/30'
  return (
    <div className="space-y-2">
      <Label className="text-white/60 text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
        placeholder={placeholder}
        className={inputCls + ' font-mono'}
      />
      {value && (
        <p className="text-xs text-white/40">
          Access later with <code className="text-primary">{`{{${value}}}`}</code>
        </p>
      )}
    </div>
  )
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[]
  onChange: (options: string[]) => void
}) {
  const [newOption, setNewOption] = useState('')

  const add = () => {
    const v = newOption.trim()
    if (!v) return
    onChange([...options, v])
    setNewOption('')
  }

  return (
    <div className="space-y-2">
      <Label className="text-white/60 text-xs">Options ({options.length})</Label>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] text-white/30 w-4">{i + 1}.</span>
            <Input
              value={opt}
              onChange={(e) => onChange(options.map((o, j) => (j === i ? e.target.value : o)))}
              className="bg-[#1e1f22] border-white/10 text-white text-xs h-8"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-400 hover:text-red-300 shrink-0"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add option…"
          className="bg-[#1e1f22] border-white/10 text-white text-xs h-8"
        />
        <Button size="sm" variant="outline" onClick={add} className="shrink-0 h-8">
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  )
}

function VariableHelp() {
  return (
    <div className="bg-white/5 rounded-lg p-3 text-xs text-white/50 space-y-1.5">
      <p className="font-semibold text-white/70">Available variables:</p>
      <p><code className="text-primary">{`{{sender}}`}</code> — sender's username</p>
      <p><code className="text-primary">{`{{body}}`}</code> — the original message</p>
      <p><code className="text-primary">{`{{args}}`}</code> — command arguments</p>
      <p><code className="text-primary">{`{{varName}}`}</code> — any variable from Input/Set Variable nodes</p>
    </div>
  )
}
