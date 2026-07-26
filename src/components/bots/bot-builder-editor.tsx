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
import { Zap, MessageSquare, GitBranch, Clock, Keyboard, Globe, Save, Trash2 } from 'lucide-react'
import type { BotFlow, FlowNode, NodeType } from '@/lib/bot/flow-types'

const NODE_STYLES: Record<NodeType, { color: string; icon: typeof Zap; label: string }> = {
  trigger: { color: '#5865F2', icon: Zap, label: 'Trigger' },
  message: { color: '#57F287', icon: MessageSquare, label: 'Message' },
  condition: { color: '#FEE75C', icon: GitBranch, label: 'Condition' },
  delay: { color: '#EB459E', icon: Clock, label: 'Delay' },
  input: { color: '#ED4245', icon: Keyboard, label: 'Input' },
  apiCall: { color: '#9B59B6', icon: Globe, label: 'API Call' },
}

function CustomNode({ data, type }: { data: any; type: string }) {
  const config = NODE_STYLES[type as NodeType] || NODE_STYLES.message
  const Icon = config.icon
  return (
    <div className="bg-[#2b2d31] border-2 rounded-xl p-3 min-w-[180px] max-w-[240px] text-white" style={{ borderColor: config.color + '60' }}>
      {type !== 'trigger' && <Handle type="target" position={Position.Top} style={{ background: config.color }} />}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: config.color + '30' }}>
          <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: config.color }}>{config.label}</span>
      </div>
      <div className="text-sm text-white/80 truncate">{data.label || data.text || data.command || data.prompt || 'Configure...'}</div>
      {type === 'condition' ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true" style={{ background: '#57F287', left: '30%' }} />
          <Handle type="source" position={Position.Bottom} id="false" style={{ background: '#ED4245', left: '70%' }} />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} style={{ background: config.color }} />
      )}
    </div>
  )
}

const nodeTypes = { custom: CustomNode }

const PALETTE: { type: NodeType; label: string; icon: typeof Zap }[] = [
  { type: 'trigger', label: 'Trigger', icon: Zap },
  { type: 'message', label: 'Message', icon: MessageSquare },
  { type: 'condition', label: 'Condition', icon: GitBranch },
  { type: 'delay', label: 'Delay', icon: Clock },
  { type: 'input', label: 'Input', icon: Keyboard },
  { type: 'apiCall', label: 'API Call', icon: Globe },
]

interface BotBuilderEditorProps {
  initialFlow?: BotFlow
  onSave: (flow: BotFlow) => void
}

export function BotBuilderEditor({ initialFlow, onSave }: BotBuilderEditorProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const initialNodes: Node[] = (initialFlow?.nodes || [{
    id: 'trigger-1', type: 'custom', position: { x: 250, y: 50 },
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
    const config = NODE_STYLES[type]
    setNodes((nds) => [...nds, {
      id, type: 'custom', position: { x: 250 + Math.random() * 100, y: 150 + nds.length * 80 },
      data: { type, label: config.label, ...(type === 'trigger' ? { triggerType: 'command', command: '' } : {}),
        ...(type === 'message' ? { text: '' } : {}), ...(type === 'condition' ? { variable: '', operator: 'exists', value: '' } : {}),
        ...(type === 'delay' ? { seconds: 1 } : {}), ...(type === 'input' ? { prompt: '', variableName: '' } : {}),
        ...(type === 'apiCall' ? { url: '', method: 'GET' } : {}) },
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
      <div className="w-48 shrink-0 bg-[#2b2d31] border-r border-white/5 p-3 space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2 px-1">Nodes</h3>
        {PALETTE.map((item) => {
          const Icon = item.icon
          const config = NODE_STYLES[item.type]
          return (
            <button key={item.type} onClick={() => addNode(item.type)} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors text-left">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: config.color + '30' }}>
                <Icon className="w-4 h-4" style={{ color: config.color }} />
              </div>
              <span className="text-sm text-white/80">{item.label}</span>
            </button>
          )
        })}
        <div className="pt-4 border-t border-white/5 mt-4">
          <Button onClick={handleSave} className="w-full" size="sm"><Save className="w-4 h-4 mr-1.5" /> Save Flow</Button>
        </div>
      </div>
      <div className="flex-1 relative">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNode(node.id)} nodeTypes={nodeTypes} fitView className="bg-[#1e1f22]"
          defaultEdgeOptions={{ animated: true, style: { stroke: '#5865F2', strokeWidth: 2 } }}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ffffff10" />
          <Controls className="!bg-[#2b2d31] !border-white/10" />
          <MiniMap className="!bg-[#2b2d31] !border-white/10" nodeColor="#5865F2" maskColor="rgba(0,0,0,0.5)" />
        </ReactFlow>
      </div>
      {selectedNode && selectedNodeData && (
        <div className="w-72 shrink-0 bg-[#2b2d31] border-l border-white/5 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white/80">Configure Node</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => deleteNode(selectedNode)}><Trash2 className="w-4 h-4" /></Button>
          </div>
          <NodeInspector nodeType={selectedNodeData.type} data={selectedNodeData} onUpdate={(update) => updateNodeData(selectedNode, update)} />
        </div>
      )}
    </div>
  )
}

function NodeInspector({ nodeType, data, onUpdate }: { nodeType: NodeType; data: any; onUpdate: (update: any) => void }) {
  return (
    <div className="space-y-3">
      {nodeType === 'trigger' && (
        <>
          <div className="space-y-2">
            <Label className="text-white/60 text-xs">Trigger Type</Label>
            <Select value={data.triggerType || 'command'} onValueChange={(v) => onUpdate({ triggerType: v })}>
              <SelectTrigger className="bg-[#1e1f22] border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="command">Command (/command)</SelectItem><SelectItem value="mention">Mention (@bot)</SelectItem><SelectItem value="message">Any message</SelectItem></SelectContent>
            </Select>
          </div>
          {data.triggerType === 'command' && (
            <div className="space-y-2">
              <Label className="text-white/60 text-xs">Command</Label>
              <Input value={data.command || ''} onChange={(e) => onUpdate({ command: e.target.value })} placeholder="hello" className="bg-[#1e1f22] border-white/10 text-white" />
              <p className="text-xs text-white/40">User types /hello to trigger</p>
            </div>
          )}
        </>
      )}
      {nodeType === 'message' && (
        <div className="space-y-2">
          <Label className="text-white/60 text-xs">Message Text</Label>
          <Textarea value={data.text || ''} onChange={(e) => onUpdate({ text: e.target.value })} placeholder="Hello! How can I help?" rows={4} className="bg-[#1e1f22] border-white/10 text-white resize-none" />
          <p className="text-xs text-white/40">Use {'{{sender}}'}, {'{{args}}'}, {'{{varName}}'} for variables</p>
        </div>
      )}
      {nodeType === 'condition' && (
        <>
          <div className="space-y-2"><Label className="text-white/60 text-xs">Variable</Label><Input value={data.variable || ''} onChange={(e) => onUpdate({ variable: e.target.value })} placeholder="userInput" className="bg-[#1e1f22] border-white/10 text-white" /></div>
          <div className="space-y-2"><Label className="text-white/60 text-xs">Operator</Label><Select value={data.operator || 'exists'} onValueChange={(v) => onUpdate({ operator: v })}><SelectTrigger className="bg-[#1e1f22] border-white/10 text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="equals">Equals</SelectItem><SelectItem value="contains">Contains</SelectItem><SelectItem value="exists">Exists</SelectItem><SelectItem value="not_exists">Does not exist</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label className="text-white/60 text-xs">Value</Label><Input value={data.value || ''} onChange={(e) => onUpdate({ value: e.target.value })} placeholder="yes" className="bg-[#1e1f22] border-white/10 text-white" /></div>
          <p className="text-xs text-white/40">Green = true, Red = false</p>
        </>
      )}
      {nodeType === 'delay' && (<div className="space-y-2"><Label className="text-white/60 text-xs">Seconds</Label><Input type="number" value={data.seconds || 1} onChange={(e) => onUpdate({ seconds: parseInt(e.target.value, 10) || 1 })} min={1} max={60} className="bg-[#1e1f22] border-white/10 text-white" /></div>)}
      {nodeType === 'input' && (<><div className="space-y-2"><Label className="text-white/60 text-xs">Prompt</Label><Textarea value={data.prompt || ''} onChange={(e) => onUpdate({ prompt: e.target.value })} placeholder="What's your name?" rows={2} className="bg-[#1e1f22] border-white/10 text-white resize-none" /></div><div className="space-y-2"><Label className="text-white/60 text-xs">Store as variable</Label><Input value={data.variableName || ''} onChange={(e) => onUpdate({ variableName: e.target.value })} placeholder="userName" className="bg-[#1e1f22] border-white/10 text-white" /></div></>)}
      {nodeType === 'apiCall' && (<><div className="space-y-2"><Label className="text-white/60 text-xs">URL</Label><Input value={data.url || ''} onChange={(e) => onUpdate({ url: e.target.value })} placeholder="https://api.example.com/data" className="bg-[#1e1f22] border-white/10 text-white" /></div><div className="space-y-2"><Label className="text-white/60 text-xs">Method</Label><Select value={data.method || 'GET'} onValueChange={(v) => onUpdate({ method: v })}><SelectTrigger className="bg-[#1e1f22] border-white/10 text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label className="text-white/60 text-xs">Store response as</Label><Input value={data.variableName || ''} onChange={(e) => onUpdate({ variableName: e.target.value })} placeholder="apiResult" className="bg-[#1e1f22] border-white/10 text-white" /></div></>)}
    </div>
  )
}
