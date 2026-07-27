'use client'

import { useCallback, useState } from 'react'
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
  Zap, MessageSquare, GitBranch, Clock, Keyboard, Globe,
  Save, Trash2, Plus, Webhook, Variable, AlertCircle, Send,
} from 'lucide-react'
import type { BotFlow, FlowNode, NodeType } from '@/lib/bot/flow-types'

// ─── Node categories ─────────────────────────────────────────────────────────
type NodeCategory = 'trigger' | 'input' | 'output' | 'process'

interface NodeDef {
  type: NodeType
  label: string
  category: NodeCategory
  icon: typeof Zap
  color: string
  bg: string
  description: string
}

const NODE_DEFS: Record<NodeType, NodeDef> = {
  trigger: {
    type: 'trigger', label: 'Trigger', category: 'trigger',
    icon: Zap, color: '#5865F2', bg: '#5865F220',
    description: 'Starts the bot when a condition is met',
  },
  message: {
    type: 'message', label: 'Send Message', category: 'output',
    icon: Send, color: '#57F287', bg: '#57F28720',
    description: 'Sends a text message to the channel',
  },
  condition: {
    type: 'condition', label: 'Condition', category: 'process',
    icon: GitBranch, color: '#FEE75C', bg: '#FEE75C20',
    description: 'Branches based on a variable check',
  },
  delay: {
    type: 'delay', label: 'Delay', category: 'process',
    icon: Clock, color: '#EB459E', bg: '#EB459E20',
    description: 'Waits for N seconds',
  },
  input: {
    type: 'input', label: 'Wait for Input', category: 'input',
    icon: Keyboard, color: '#ED4245', bg: '#ED424520',
    description: 'Asks user a question, stores reply',
  },
  apiCall: {
    type: 'apiCall', label: 'API Call', category: 'process',
    icon: Webhook, color: '#9B59B6', bg: '#9B59B620',
    description: 'Calls an external API',
  },
}

const CATEGORIES: { key: NodeCategory; label: string; nodes: NodeType[] }[] = [
  { key: 'trigger', label: 'Triggers', nodes: ['trigger'] },
  { key: 'output', label: 'Output', nodes: ['message'] },
  { key: 'input', label: 'Input', nodes: ['input'] },
  { key: 'process', label: 'Logic', nodes: ['condition', 'delay', 'apiCall'] },
]

// ─── Custom Node Component ───────────────────────────────────────────────────

function CustomNode({ data, type }: { data: any; type: string }) {
  const def = NODE_DEFS[type as NodeType] || NODE_DEFS.message
  const Icon = def.icon
  const isTrigger = type === 'trigger'
  const isCondition = type === 'condition'

  // Build preview text based on node type
  let preview = ''
  if (data.text) preview = data.text.slice(0, 40)
  else if (data.command) preview = `/${data.command}`
  else if (data.prompt) preview = data.prompt.slice(0, 40)
  else if (data.seconds) preview = `${data.seconds}s`
  else if (data.variable) preview = `${data.variable} ${data.operator || ''} ${data.value || ''}`
  else if (data.url) preview = data.url.slice(0, 40)
  else preview = def.description

  return (
    <div
      className="bg-[#2b2d31] rounded-xl min-w-[200px] max-w-[260px] text-white shadow-lg border-l-4 overflow-hidden"
      style={{ borderLeftColor: def.color }}
    >
      {!isTrigger && <Handle type="target" position={Position.Top} style={{ background: def.color, width: 10, height: 10 }} />}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: def.bg }}>
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: def.color + '30' }}>
          <Icon className="w-3.5 h-3.5" style={{ color: def.color }} />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: def.color }}>
          {def.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 text-sm text-white/70">
        {preview || 'Configure in inspector →'}
      </div>

      {/* Handles */}
      {isCondition ? (
        <div className="flex justify-between px-3 pb-2">
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-green-400 mb-1">TRUE</span>
            <Handle type="source" position={Position.Bottom} id="true" style={{ background: '#57F287', width: 10, height: 10 }} />
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-red-400 mb-1">FALSE</span>
            <Handle type="source" position={Position.Bottom} id="false" style={{ background: '#ED4245', width: 10, height: 10 }} />
          </div>
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} style={{ background: def.color, width: 10, height: 10 }} />
      )}
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
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  const initialNodes: Node[] = (initialFlow?.nodes || [{
    id: 'trigger-1', type: 'custom', position: { x: 300, y: 50 },
    data: { type: 'trigger', triggerType: 'command', command: '', label: 'When command received' },
  }]).map((n) => ({ id: n.id, type: 'custom', position: n.position, data: { ...n.data, type: n.type } }))

  const initialEdges: Edge[] = (initialFlow?.edges || []).map((e) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || undefined,
    animated: true, style: { stroke: '#5865F2', strokeWidth: 2 },
  }))

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback((params: Connection) =>
    setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#5865F2', strokeWidth: 2 } }, eds)), [setEdges])

  const addNode = (type: NodeType) => {
    const id = `${type}-${Date.now()}`
    const def = NODE_DEFS[type]
    setNodes((nds) => [...nds, {
      id, type: 'custom',
      position: { x: 300 + Math.random() * 80, y: 150 + nds.length * 80 },
      data: {
        type,
        label: def.label,
        ...(type === 'trigger' ? { triggerType: 'command', command: '' } : {}),
        ...(type === 'message' ? { text: '' } : {}),
        ...(type === 'condition' ? { variable: '', operator: 'exists', value: '' } : {}),
        ...(type === 'delay' ? { seconds: 1 } : {}),
        ...(type === 'input' ? { prompt: '', variableName: '' } : {}),
        ...(type === 'apiCall' ? { url: '', method: 'GET', variableName: '' } : {}),
      },
    }])
  }

  const updateNodeData = (nodeId: string, dataUpdate: any) =>
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...dataUpdate } } : n)))

  const deleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedNode(null)
  }

  const handleSave = () => {
    onSave({
      nodes: nodes.map((n) => ({ id: n.id, type: n.data.type, position: n.position, data: { ...n.data } })) as FlowNode[],
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || null })),
    })
  }

  const selectedNodeData = nodes.find((n) => n.id === selectedNode)?.data

  return (
    <div className="flex h-full bg-[#1e1f22]">
      {/* Left palette — categorized */}
      <div className="w-52 shrink-0 bg-[#2b2d31] border-r border-white/5 p-3 overflow-y-auto">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3 px-1">Node Palette</h3>
        {CATEGORIES.map((cat) => (
          <div key={cat.key} className="mb-4">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1.5 px-1">{cat.label}</h4>
            {cat.nodes.map((nodeType) => {
              const def = NODE_DEFS[nodeType]
              const Icon = def.icon
              return (
                <button
                  key={nodeType}
                  onClick={() => addNode(nodeType)}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors text-left group"
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-110" style={{ background: def.bg }}>
                    <Icon className="w-4 h-4" style={{ color: def.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white/80">{def.label}</div>
                    <div className="text-[10px] text-white/30 truncate">{def.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
        <div className="pt-4 border-t border-white/5 mt-2">
          <Button onClick={handleSave} className="w-full" size="sm">
            <Save className="w-4 h-4 mr-1.5" /> Save Flow
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNode(node.id)}
          nodeTypes={nodeTypes}
          fitView
          className="bg-[#1e1f22]"
          defaultEdgeOptions={{ animated: true, style: { stroke: '#5865F2', strokeWidth: 2 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ffffff10" />
          <Controls className="!bg-[#2b2d31] !border-white/10" />
          <MiniMap className="!bg-[#2b2d31] !border-white/10" nodeColor="#5865F2" maskColor="rgba(0,0,0,0.5)" />
        </ReactFlow>
      </div>

      {/* Right inspector — node config */}
      {selectedNode && selectedNodeData && (
        <div className="w-72 shrink-0 bg-[#2b2d31] border-l border-white/5 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {(() => {
                const def = NODE_DEFS[selectedNodeData.type as NodeType]
                const Icon = def.icon
                return <Icon className="w-4 h-4" style={{ color: def.color }} />
              })()}
              <h3 className="text-sm font-semibold text-white/80">{NODE_DEFS[selectedNodeData.type as NodeType]?.label}</h3>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => deleteNode(selectedNode)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <NodeInspector nodeType={selectedNodeData.type} data={selectedNodeData} onUpdate={(update) => updateNodeData(selectedNode, update)} />
        </div>
      )}
    </div>
  )
}

// ─── Node Inspector ──────────────────────────────────────────────────────────

function NodeInspector({ nodeType, data, onUpdate }: { nodeType: NodeType; data: any; onUpdate: (update: any) => void }) {
  const inputCls = "bg-[#1e1f22] border-white/10 text-white placeholder:text-white/30"

  return (
    <div className="space-y-4">
      {nodeType === 'trigger' && (
        <>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Trigger Type</Label>
            <Select value={data.triggerType || 'command'} onValueChange={(v) => onUpdate({ triggerType: v })}>
              <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="command">Command (/command)</SelectItem>
                <SelectItem value="mention">Mention (@bot)</SelectItem>
                <SelectItem value="message">Any message</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.triggerType === 'command' && (
            <div className="space-y-2">
              <Label className="text-white/60 text-xs">Command name</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">/</span>
                <Input value={data.command || ''} onChange={(e) => onUpdate({ command: e.target.value })} placeholder="hello" className={inputCls + ' pl-7'} />
              </div>
              <p className="text-xs text-white/40">Users type this to trigger the bot</p>
            </div>
          )}
        </>
      )}

      {nodeType === 'message' && (
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Message</Label>
          <Textarea
            value={data.text || ''}
            onChange={(e) => onUpdate({ text: e.target.value })}
            placeholder="Hello {{sender}}! You said: {{args}}"
            rows={4}
            className={inputCls + ' resize-none'}
          />
          <div className="text-xs text-white/40 space-y-1">
            <p>Variables:</p>
            <p><code className="text-primary">{'{{sender}}'}</code> — sender's name</p>
            <p><code className="text-primary">{'{{args}}'}</code> — command arguments</p>
            <p><code className="text-primary">{'{{varName}}'}</code> — any stored variable</p>
          </div>
        </div>
      )}

      {nodeType === 'condition' && (
        <>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Variable to check</Label>
            <Input value={data.variable || ''} onChange={(e) => onUpdate({ variable: e.target.value })} placeholder="userInput" className={inputCls} />
          </div>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Operator</Label>
            <Select value={data.operator || 'exists'} onValueChange={(v) => onUpdate({ operator: v })}>
              <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="equals">Equals</SelectItem>
                <SelectItem value="contains">Contains</SelectItem>
                <SelectItem value="exists">Has value</SelectItem>
                <SelectItem value="not_exists">Is empty</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(data.operator === 'equals' || data.operator === 'contains') && (
            <div className="space-y-2">
              <Label className="text-white/60 text-xs">Compare with</Label>
              <Input value={data.value || ''} onChange={(e) => onUpdate({ value: e.target.value })} placeholder="yes" className={inputCls} />
            </div>
          )}
          <div className="bg-white/5 rounded-lg p-2 text-xs text-white/40">
            <p>Connect the <span className="text-green-400">TRUE</span> handle to the next node for the matching path.</p>
            <p>Connect the <span className="text-red-400">FALSE</span> handle for the non-matching path.</p>
          </div>
        </>
      )}

      {nodeType === 'delay' && (
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Wait time (seconds)</Label>
          <Input type="number" value={data.seconds || 1} onChange={(e) => onUpdate({ seconds: Math.max(1, parseInt(e.target.value, 10) || 1) })} min={1} max={60} className={inputCls} />
          <p className="text-xs text-white/40">Pauses the bot for this many seconds before continuing.</p>
        </div>
      )}

      {nodeType === 'input' && (
        <>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Question / Prompt</Label>
            <Textarea value={data.prompt || ''} onChange={(e) => onUpdate({ prompt: e.target.value })} placeholder="What's your name?" rows={2} className={inputCls + ' resize-none'} />
          </div>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Save reply as variable</Label>
            <Input value={data.variableName || ''} onChange={(e) => onUpdate({ variableName: e.target.value })} placeholder="userName" className={inputCls} />
            <p className="text-xs text-white/40">Access later with {'{{' + (data.variableName || 'varName') + '}}'}</p>
          </div>
        </>
      )}

      {nodeType === 'apiCall' && (
        <>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">URL</Label>
            <Input value={data.url || ''} onChange={(e) => onUpdate({ url: e.target.value })} placeholder="https://api.example.com/data" className={inputCls} />
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
            <Label className="text-white/60 text-xs">Save response as variable</Label>
            <Input value={data.variableName || ''} onChange={(e) => onUpdate({ variableName: e.target.value })} placeholder="apiResult" className={inputCls} />
          </div>
        </>
      )}
    </div>
  )
}
