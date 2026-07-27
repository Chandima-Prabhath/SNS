'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
  Handle,
  Position,
  MarkerType,
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
  Zap, Send, ListChecks, Loader, Keyboard, MousePointerClick,
  GitBranch, Variable, Clock, Square, Webhook, Shuffle,
  Save, Trash2, Plus, X, AlertTriangle, Info, Sparkles,
} from 'lucide-react'
import {
  type BotFlow, type FlowNode, type NodeType, type NodeCategory,
  NODE_DEFS, CATEGORY_ORDER, CATEGORY_LABELS, defaultNodeData,
} from '@/lib/bot/flow-types'

// ─── Icon registry ───────────────────────────────────────────────────────────
const ICONS: Record<string, typeof Zap> = {
  Zap, Send, ListChecks, Loader, Keyboard, MousePointerClick,
  GitBranch, Variable, Clock, Square, Webhook, Shuffle,
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
    case 'choice':
      preview = { label: 'Options', value: (data.options || []).join(' · ') || '(none)' }
      break
    case 'typing':
      preview = { label: 'For', value: `${data.seconds || 1}s` }
      break
    case 'input':
      preview = { label: 'Asks', value: data.prompt || '(empty)' }
      break
    case 'wait_choice':
      preview = { label: 'Picks from', value: (data.options || []).join(' · ') || '(none)' }
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
          style={{ background: def.color, width: 10, height: 10, border: 'none' }}
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
            {(nodeType === 'input' || nodeType === 'wait_choice' || nodeType === 'choice' || nodeType === 'api_call') && data.variableName && (
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
              style={{ background: '#34D399', width: 10, height: 10, border: 'none' }}
            />
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold text-red-400 mb-1">FALSE</span>
            <Handle
              type="source"
              position={Position.Bottom}
              id="false"
              style={{ background: '#F87171', width: 10, height: 10, border: 'none' }}
            />
          </div>
        </div>
      ) : isRandom ? (
        <div className="px-3 pb-2 pt-1 text-center">
          <span className="text-[10px] text-white/40 mb-1 block">All outgoing edges are random picks</span>
          <Handle
            type="source"
            position={Position.Bottom}
            style={{ background: def.color, width: 10, height: 10, border: 'none' }}
          />
        </div>
      ) : !isStop ? (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: def.color, width: 10, height: 10, border: 'none' }}
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
}

export function BotBuilderEditor({ initialFlow, onSave }: BotBuilderEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

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

  // Keyboard shortcuts: Delete/Backspace deletes the selected node or edge.
  // ReactFlow's built-in `deleteKeyCode` only handles nodes, so we wire up
  // edges manually here.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // Don't intercept if the user is typing in an input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (selectedNodeId) {
        e.preventDefault()
        deleteNode(selectedNodeId)
      } else if (selectedEdgeId) {
        e.preventDefault()
        deleteEdge(selectedEdgeId)
      }
    },
    [selectedNodeId, selectedEdgeId] // eslint-disable-line react-hooks/exhaustive-deps
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

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null

  // ── Validation warnings ──────────────────────────────────────────────
  const warnings = useMemo(() => {
    const w: string[] = []
    const triggerCount = nodes.filter((n) => n.data.type === 'trigger').length
    if (triggerCount === 0) w.push('No trigger node — the bot will never start.')
    if (triggerCount > 1) w.push('Multiple trigger nodes — only the first one will be used.')

    // Orphaned nodes (no incoming or outgoing edges, except trigger)
    const connected = new Set<string>()
    edges.forEach((e) => { connected.add(e.source); connected.add(e.target) })
    const orphans = nodes.filter((n) => n.data.type !== 'trigger' && !connected.has(n.id))
    if (orphans.length > 0) w.push(`${orphans.length} node(s) are not connected to the flow.`)

    return w
  }, [nodes, edges])

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
          {!selectedNodeId && !selectedEdgeId && warnings.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
            </div>
          )}
          <div className="flex-1" />
          <span className="text-[10px] text-white/30">
            Click an edge to select · <kbd className="px-1 py-0.5 bg-white/10 rounded">Del</kbd> to delete
          </span>
        </div>

        {/* Warnings strip */}
        {warnings.length > 0 && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-300">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
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

      {/* ─── RIGHT: inspector ──────────────────────────────────────────── */}
      <div className="w-72 shrink-0 bg-[#2b2d31] border-l border-white/5 flex flex-col">
        {selectedNode ? (
          <NodeInspectorPanel
            node={selectedNode}
            onUpdate={(patch) => updateNodeData(selectedNode.id, patch)}
            onDelete={() => deleteNode(selectedNode.id)}
          />
        ) : (
          <EmptyInspector />
        )}
      </div>
    </div>
  )
}

// ─── Empty inspector state ───────────────────────────────────────────────────
function EmptyInspector() {
  return (
    <div className="p-4 flex flex-col h-full">
      <h3 className="text-sm font-semibold text-white/80 mb-3">Inspector</h3>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
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
        </ul>
      </div>
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

  // ── CHOICE ───────────────────────────────────────────────────────────
  if (nodeType === 'choice') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Prompt</Label>
          <Textarea
            value={data.prompt || ''}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="What would you like to do?"
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
        <p className="text-xs text-white/40">
          Pair this with a <span className="text-orange-400">Wait for Choice</span> node to actually wait for the user's reply.
        </p>
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
          <p className="font-semibold text-orange-400 mb-1">Waits for a valid choice</p>
          <p>The user must reply with one of the options (by number or text). Invalid replies will be re-prompted.</p>
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

  return null
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
