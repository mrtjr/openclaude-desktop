import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  X, Plus, Play, Save, Download, Trash2, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, ZapOff, Zap, Copy,
  GitBranch, Settings2, Cpu, FileOutput, MousePointer2, List,
  ChevronDown, Edit3
} from 'lucide-react'

interface AppSettings {
  provider: 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal'
  openaiApiKey: string; openaiModel: string
  geminiApiKey: string; geminiModel: string
  anthropicApiKey: string; anthropicModel: string
  openrouterApiKey: string; openrouterModel: string
  modalApiKey: string; modalModel: string; modalHostname: string
  language: 'pt' | 'en'
  temperature: number; maxTokens: number
}

interface WorkflowBuilderProps {
  settings: AppSettings
  onClose: () => void
  onInsertToChat: (text: string) => void
}

interface WorkflowNode {
  id: string
  type: 'trigger' | 'prompt' | 'tool' | 'condition' | 'output'
  label: string
  config: Record<string, any>
  x: number
  y: number
}

interface WorkflowEdge {
  id: string
  fromId: string
  toId: string
}

interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: number
}

interface ExecLogEntry {
  nodeId: string
  nodeLabel: string
  status: 'running' | 'done' | 'error' | 'skipped'
  output: string
  timestamp: number
}

const NODE_COLORS: Record<WorkflowNode['type'], string> = {
  trigger: '#f97316',
  prompt: '#6366f1',
  tool: '#22c55e',
  condition: '#f59e0b',
  output: '#a855f7',
}

const NODE_ICONS: Record<WorkflowNode['type'], React.ReactNode> = {
  trigger: <Zap size={13} />,
  prompt: <Cpu size={13} />,
  tool: <Settings2 size={13} />,
  condition: <GitBranch size={13} />,
  output: <FileOutput size={13} />,
}

const NODE_DEFAULTS: Record<WorkflowNode['type'], { label: string; config: Record<string, any> }> = {
  trigger: { label: 'Gatilho', config: { triggerType: 'manual', watchPath: '', schedule: '' } },
  prompt: { label: 'Prompt IA', config: { promptTemplate: 'Responda sobre: {{input}}', provider: 'ollama', model: 'llama3' } },
  tool: { label: 'Ferramenta', config: { toolName: 'exec_command', params: {} } },
  condition: { label: 'Condição', config: { expression: '' } },
  output: { label: 'Saída', config: { destination: 'chat', filePath: '' } },
}

const PALETTE_NODES: WorkflowNode['type'][] = ['trigger', 'prompt', 'tool', 'condition', 'output']

function buildTopologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []) }
  for (const e of edges) {
    adj.get(e.fromId)?.push(e.toId)
    inDegree.set(e.toId, (inDegree.get(e.toId) ?? 0) + 1)
  }
  const queue = nodes.filter(n => inDegree.get(n.id) === 0)
  const result: WorkflowNode[] = []
  while (queue.length > 0) {
    const n = queue.shift()!
    result.push(n)
    for (const nbr of adj.get(n.id) ?? []) {
      const d = (inDegree.get(nbr) ?? 1) - 1
      inDegree.set(nbr, d)
      if (d === 0) queue.push(nodes.find(x => x.id === nbr)!)
    }
  }
  return result.filter(Boolean)
}

function getApiKey(settings: AppSettings): string {
  switch (settings.provider) {
    case 'openai': return settings.openaiApiKey
    case 'gemini': return settings.geminiApiKey
    case 'anthropic': return settings.anthropicApiKey
    case 'openrouter': return settings.openrouterApiKey
    case 'modal': return settings.modalApiKey
    default: return ''
  }
}

function getProviderModel(settings: AppSettings, provider: string, model: string): { apiKey: string; model: string } {
  if (provider === 'ollama') return { apiKey: '', model }
  const key = getApiKey({ ...settings, provider: provider as any })
  return { apiKey: key, model }
}

export default function WorkflowBuilder({ settings, onClose, onInsertToChat }: WorkflowBuilderProps) {
  // Workflows list
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null)
  const [loadingWorkflows, setLoadingWorkflows] = useState(true)

  // Canvas state
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [dragNodeId, setDragNodeId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  // Config panel
  const [editingName, setEditingName] = useState(false)
  const [workflowName, setWorkflowName] = useState('')
  const [workflowDesc, setWorkflowDesc] = useState('')

  // Execution
  const [running, setRunning] = useState(false)
  const [execLog, setExecLog] = useState<ExecLogEntry[]>([])
  const [showExecLog, setShowExecLog] = useState(false)

  // Messages
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const svgRef = useRef<SVGSVGElement>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)

  // Load workflows on mount
  useEffect(() => {
    loadWorkflows()
  }, [])

  const loadWorkflows = async () => {
    setLoadingWorkflows(true)
    try {
      const result = await window.electron.workflowLoad()
      setWorkflows(result.workflows || [])
    } catch {}
    finally { setLoadingWorkflows(false) }
  }

  const saveWorkflows = async (wfs: Workflow[]) => {
    setSaveStatus('saving')
    try {
      const result = await window.electron.workflowSave(wfs)
      if (result.error) throw new Error(result.error)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const createNewWorkflow = () => {
    const wf: Workflow = {
      id: Date.now().toString(),
      name: 'Novo Workflow',
      description: '',
      nodes: [],
      edges: [],
      createdAt: Date.now(),
    }
    setWorkflows(prev => [...prev, wf])
    openWorkflow(wf)
  }

  const openWorkflow = (wf: Workflow) => {
    setActiveWorkflow(wf)
    setNodes(wf.nodes)
    setEdges(wf.edges)
    setWorkflowName(wf.name)
    setWorkflowDesc(wf.description)
    setSelectedNodeId(null)
    setConnectMode(false)
    setConnectFrom(null)
    setExecLog([])
    setShowExecLog(false)
  }

  const syncActiveWorkflow = useCallback((updatedNodes: WorkflowNode[], updatedEdges: WorkflowEdge[]) => {
    setActiveWorkflow(prev => {
      if (!prev) return prev
      return { ...prev, nodes: updatedNodes, edges: updatedEdges, name: workflowName, description: workflowDesc }
    })
  }, [workflowName, workflowDesc])

  const saveCurrentWorkflow = useCallback(() => {
    if (!activeWorkflow) return
    const updated: Workflow = {
      ...activeWorkflow,
      name: workflowName,
      description: workflowDesc,
      nodes,
      edges,
    }
    const updatedList = workflows.map(w => w.id === updated.id ? updated : w)
    setWorkflows(updatedList)
    setActiveWorkflow(updated)
    saveWorkflows(updatedList)
  }, [activeWorkflow, workflowName, workflowDesc, nodes, edges, workflows])

  const deleteWorkflow = (id: string) => {
    const updated = workflows.filter(w => w.id !== id)
    setWorkflows(updated)
    saveWorkflows(updated)
    if (activeWorkflow?.id === id) {
      setActiveWorkflow(null)
      setNodes([])
      setEdges([])
    }
  }

  // Node management
  const addNode = useCallback((type: WorkflowNode['type'], x = 120, y = 120) => {
    const def = NODE_DEFAULTS[type]
    const node: WorkflowNode = {
      id: `node-${Date.now()}`,
      type,
      label: def.label,
      config: { ...def.config },
      x,
      y,
    }
    setNodes(prev => {
      const updated = [...prev, node]
      return updated
    })
    setSelectedNodeId(node.id)
  }, [])

  const updateNode = (id: string, updates: Partial<WorkflowNode>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n))
  }

  const updateNodeConfig = (id: string, configUpdates: Record<string, any>) => {
    setNodes(prev => prev.map(n => n.id === id
      ? { ...n, config: { ...n.config, ...configUpdates } }
      : n
    ))
  }

  const deleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id))
    setEdges(prev => prev.filter(e => e.fromId !== id && e.toId !== id))
    if (selectedNodeId === id) setSelectedNodeId(null)
  }

  // Canvas drag
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (connectMode) {
      if (!connectFrom) {
        setConnectFrom(nodeId)
      } else if (connectFrom !== nodeId) {
        const exists = edges.some(e => e.fromId === connectFrom && e.toId === nodeId)
        if (!exists) {
          const newEdge: WorkflowEdge = { id: `edge-${Date.now()}`, fromId: connectFrom, toId: nodeId }
          setEdges(prev => [...prev, newEdge])
        }
        setConnectFrom(null)
        setConnectMode(false)
      }
      return
    }
    setSelectedNodeId(nodeId)
    const node = nodes.find(n => n.id === nodeId)!
    setDragNodeId(nodeId)
    setDragOffset({ x: e.clientX - node.x - canvasOffset.x, y: e.clientY - node.y - canvasOffset.y })
  }

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragNodeId) {
      const x = e.clientX - dragOffset.x - canvasOffset.x
      const y = e.clientY - dragOffset.y - canvasOffset.y
      setNodes(prev => prev.map(n => n.id === dragNodeId ? { ...n, x, y } : n))
    } else if (isPanning) {
      setCanvasOffset(prev => ({
        x: prev.x + e.clientX - panStart.x,
        y: prev.y + e.clientY - panStart.y,
      }))
      setPanStart({ x: e.clientX, y: e.clientY })
    }
  }, [dragNodeId, dragOffset, canvasOffset, isPanning, panStart])

  const handleCanvasMouseUp = () => {
    setDragNodeId(null)
    setIsPanning(false)
  }

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as Element).tagName === 'svg') {
      setSelectedNodeId(null)
      setConnectFrom(null)
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
    }
  }

  const handlePaletteNodeDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('node-type') as WorkflowNode['type']
    if (!type) return
    const rect = canvasContainerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left - canvasOffset.x - 60
    const y = e.clientY - rect.top - canvasOffset.y - 20
    addNode(type, Math.max(0, x), Math.max(0, y))
  }

  const deleteEdge = (id: string) => {
    setEdges(prev => prev.filter(e => e.id !== id))
  }

  // Edge path calculation
  const getEdgePath = (edge: WorkflowEdge): string => {
    const from = nodes.find(n => n.id === edge.fromId)
    const to = nodes.find(n => n.id === edge.toId)
    if (!from || !to) return ''
    const x1 = from.x + 80, y1 = from.y + 20
    const x2 = to.x + 80, y2 = to.y + 20
    const cx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`
  }

  // Selected node
  const selectedNode = nodes.find(n => n.id === selectedNodeId)

  // Workflow execution
  const executeWorkflow = async () => {
    if (!activeWorkflow || nodes.length === 0) return
    setRunning(true)
    setExecLog([])
    setShowExecLog(true)

    const ordered = buildTopologicalOrder(nodes, edges)
    let prevOutput = ''

    for (const node of ordered) {
      const logEntry: ExecLogEntry = {
        nodeId: node.id,
        nodeLabel: node.label,
        status: 'running',
        output: '',
        timestamp: Date.now(),
      }
      setExecLog(prev => [...prev, logEntry])

      const updateLog = (updates: Partial<ExecLogEntry>) => {
        setExecLog(prev => prev.map(e => e.nodeId === node.id ? { ...e, ...updates } : e))
      }

      try {
        let output = ''

        switch (node.type) {
          case 'trigger': {
            if (node.config.triggerType === 'manual') {
              output = 'Gatilho manual acionado'
            } else if (node.config.triggerType === 'file_watch') {
              output = `Observando: ${node.config.watchPath}`
            } else {
              output = `Agendamento: ${node.config.schedule}`
            }
            break
          }
          case 'prompt': {
            const tpl = (node.config.promptTemplate || '').replace('{{input}}', prevOutput)
            const { apiKey, model } = getProviderModel(settings, node.config.provider || settings.provider, node.config.model || 'llama3')
            const result = await window.electron.providerChat({
              provider: node.config.provider || settings.provider,
              apiKey,
              model,
              messages: [{ role: 'user', content: tpl }],
              temperature: settings.temperature,
              maxTokens: settings.maxTokens,
            })
            if (result.error) throw new Error(result.error)
            output = result.content || result.response || ''
            break
          }
          case 'tool': {
            const toolName = node.config.toolName || 'exec_command'
            if (toolName === 'exec_command') {
              const cmd = node.config.params?.command || 'echo hello'
              const r = await window.electron.execCommand(cmd)
              output = r.stdout || r.stderr || r.error || ''
            } else if (toolName === 'web_search') {
              const query = (node.config.params?.query || prevOutput).replace('{{input}}', prevOutput)
              const r = await window.electron.webSearch(query)
              output = r.result || r.error || ''
            } else if (toolName === 'read_file') {
              const path = node.config.params?.filePath || ''
              const r = await window.electron.readFile(path)
              output = r.content || r.error || ''
            } else if (toolName === 'write_file') {
              const content = (node.config.params?.content || prevOutput).replace('{{input}}', prevOutput)
              const r = await window.electron.writeFile({ filePath: node.config.params?.filePath || '', content })
              output = r.error ? `Erro: ${r.error}` : 'Arquivo escrito com sucesso'
            }
            break
          }
          case 'condition': {
            const expr = node.config.expression || ''
            const matches = prevOutput.toLowerCase().includes(expr.toLowerCase())
            output = matches ? `Condição verdadeira: "${expr}" encontrado` : `Condição falsa: "${expr}" não encontrado`
            if (!matches) {
              updateLog({ status: 'skipped', output })
              continue
            }
            break
          }
          case 'output': {
            const dest = node.config.destination || 'chat'
            if (dest === 'chat') {
              onInsertToChat(prevOutput)
              output = 'Enviado para o chat'
            } else if (dest === 'clipboard') {
              await navigator.clipboard.writeText(prevOutput)
              output = 'Copiado para área de transferência'
            } else if (dest === 'file') {
              const fp = node.config.filePath || ''
              if (fp) {
                const r = await window.electron.writeFile({ filePath: fp, content: prevOutput })
                output = r.error ? `Erro: ${r.error}` : `Salvo em: ${fp}`
              } else {
                output = 'Caminho do arquivo não configurado'
              }
            }
            break
          }
        }

        prevOutput = output
        updateLog({ status: 'done', output })
      } catch (e: any) {
        updateLog({ status: 'error', output: e?.message ?? 'Erro desconhecido' })
        break
      }
    }

    setRunning(false)
  }

  const exportWorkflowJSON = () => {
    if (!activeWorkflow) return
    const json = JSON.stringify({ ...activeWorkflow, nodes, edges }, null, 2)
    navigator.clipboard.writeText(json)
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (connectMode) { setConnectMode(false); setConnectFrom(null) }
        else if (selectedNodeId) setSelectedNodeId(null)
        else onClose()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveCurrentWorkflow()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, connectMode, selectedNodeId, saveCurrentWorkflow])

  return (
    <div className="wf-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="wf-modal">
        {/* Header */}
        <div className="wf-header">
          <div className="wf-header-left">
            <div className="wf-icon-wrap">
              <GitBranch size={18} />
            </div>
            <div>
              <h2 className="wf-title">Workflow Builder</h2>
              <p className="wf-subtitle">Automação visual com IA</p>
            </div>
          </div>
          <div className="wf-header-right">
            {activeWorkflow && (
              <>
                <button
                  className={`wf-connect-btn ${connectMode ? 'wf-connect-active' : ''}`}
                  onClick={() => { setConnectMode(!connectMode); setConnectFrom(null) }}
                  title="Modo de conexão: clique em dois nós para conectá-los"
                >
                  <MousePointer2 size={13} />
                  {connectMode ? (connectFrom ? 'Clique no destino' : 'Clique na origem') : 'Conectar nós'}
                </button>
                <button
                  className="wf-run-btn"
                  onClick={executeWorkflow}
                  disabled={running || nodes.length === 0}
                >
                  {running ? <Loader2 size={13} className="wf-spin" /> : <Play size={13} />}
                  {running ? 'Executando…' : 'Executar'}
                </button>
                <button className="wf-save-btn" onClick={saveCurrentWorkflow}>
                  <Save size={13} />
                  {saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? 'Salvo!' : 'Salvar'}
                </button>
                <button className="wf-icon-btn" onClick={exportWorkflowJSON} title="Exportar JSON">
                  <Copy size={14} />
                </button>
              </>
            )}
            <button className="wf-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="wf-body">
          {/* WORKFLOWS LIST sidebar */}
          <div className="wf-sidebar">
            <div className="wf-sidebar-header">
              <span className="wf-sidebar-title">Workflows</span>
              <button className="wf-new-btn" onClick={createNewWorkflow}>
                <Plus size={13} /> Novo
              </button>
            </div>
            {loadingWorkflows ? (
              <div className="wf-sidebar-loading"><Loader2 size={14} className="wf-spin" /> Carregando…</div>
            ) : workflows.length === 0 ? (
              <div className="wf-sidebar-empty">
                <ZapOff size={20} />
                <p>Nenhum workflow</p>
                <span>Crie um para começar</span>
              </div>
            ) : (
              <div className="wf-workflow-list">
                {workflows.map(wf => (
                  <div
                    key={wf.id}
                    className={`wf-workflow-item ${activeWorkflow?.id === wf.id ? 'wf-workflow-active' : ''}`}
                    onClick={() => openWorkflow(wf)}
                  >
                    <div className="wf-workflow-info">
                      <span className="wf-workflow-name">{wf.name}</span>
                      <span className="wf-workflow-meta">{wf.nodes.length} nós</span>
                    </div>
                    <button
                      className="wf-delete-wf-btn"
                      onClick={e => { e.stopPropagation(); deleteWorkflow(wf.id) }}
                      title="Excluir"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CANVAS area */}
          <div className="wf-canvas-area">
            {!activeWorkflow ? (
              <div className="wf-canvas-placeholder">
                <GitBranch size={40} />
                <p>Selecione ou crie um workflow</p>
                <button className="wf-create-first-btn" onClick={createNewWorkflow}>
                  <Plus size={14} /> Criar workflow
                </button>
              </div>
            ) : (
              <>
                {/* Workflow name bar */}
                <div className="wf-canvas-topbar">
                  {editingName ? (
                    <input
                      className="wf-name-edit"
                      value={workflowName}
                      onChange={e => setWorkflowName(e.target.value)}
                      onBlur={() => setEditingName(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setEditingName(false) }}
                      autoFocus
                    />
                  ) : (
                    <button className="wf-name-display" onClick={() => setEditingName(true)}>
                      <Edit3 size={12} />
                      {workflowName}
                    </button>
                  )}
                  <span className="wf-canvas-hint">
                    {connectMode
                      ? (connectFrom ? '→ Clique no nó destino' : '→ Clique no nó origem')
                      : 'Drag nós do palette • Ctrl+S para salvar'}
                  </span>
                </div>

                {/* Node palette */}
                <div className="wf-palette">
                  {PALETTE_NODES.map(type => (
                    <div
                      key={type}
                      className="wf-palette-node"
                      style={{ borderColor: NODE_COLORS[type] }}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('node-type', type)}
                      onClick={() => addNode(type, 80 + nodes.length * 20, 80 + nodes.length * 20)}
                      title={`Adicionar ${type}`}
                    >
                      <span style={{ color: NODE_COLORS[type] }}>{NODE_ICONS[type]}</span>
                      <span className="wf-palette-label">{type}</span>
                    </div>
                  ))}
                </div>

                {/* SVG Canvas */}
                <div
                  ref={canvasContainerRef}
                  className="wf-canvas-container"
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                  onDragOver={e => e.preventDefault()}
                  onDrop={handlePaletteNodeDrop}
                >
                  <svg
                    ref={svgRef}
                    className="wf-svg"
                    onMouseDown={handleCanvasMouseDown}
                  >
                    <g transform={`translate(${canvasOffset.x},${canvasOffset.y})`}>
                      {/* Edges */}
                      {edges.map(edge => {
                        const path = getEdgePath(edge)
                        if (!path) return null
                        return (
                          <g key={edge.id}>
                            <path
                              d={path}
                              fill="none"
                              stroke="rgba(255,255,255,0.15)"
                              strokeWidth="2"
                              markerEnd="url(#arrowhead)"
                            />
                            <path
                              d={path}
                              fill="none"
                              stroke="transparent"
                              strokeWidth="12"
                              style={{ cursor: 'pointer' }}
                              onClick={() => deleteEdge(edge.id)}
                            />
                          </g>
                        )
                      })}

                      {/* Arrow marker */}
                      <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                          <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.3)" />
                        </marker>
                      </defs>

                      {/* Nodes */}
                      {nodes.map(node => {
                        const isSelected = selectedNodeId === node.id
                        const isConnectFrom = connectFrom === node.id
                        const color = NODE_COLORS[node.type]
                        return (
                          <foreignObject
                            key={node.id}
                            x={node.x}
                            y={node.y}
                            width={160}
                            height={56}
                            style={{ overflow: 'visible' }}
                          >
                            <div
                              className={`wf-node ${isSelected ? 'wf-node-selected' : ''} ${isConnectFrom ? 'wf-node-connect-from' : ''}`}
                              style={{
                                borderColor: isSelected ? color : isConnectFrom ? '#22c55e' : 'rgba(255,255,255,0.1)',
                                background: `linear-gradient(135deg, ${color}14, ${color}06)`,
                              }}
                              onMouseDown={e => handleNodeMouseDown(e, node.id)}
                            >
                              <div className="wf-node-header" style={{ borderBottom: `1px solid ${color}30` }}>
                                <span style={{ color }}>{NODE_ICONS[node.type]}</span>
                                <span className="wf-node-type" style={{ color }}>{node.type}</span>
                                <button
                                  className="wf-node-delete"
                                  onClick={e => { e.stopPropagation(); deleteNode(node.id) }}
                                >
                                  <X size={10} />
                                </button>
                              </div>
                              <div className="wf-node-label">{node.label}</div>
                            </div>
                          </foreignObject>
                        )
                      })}
                    </g>
                  </svg>
                </div>

                {/* Execution log */}
                {showExecLog && (
                  <div className="wf-exec-log">
                    <div className="wf-exec-log-header">
                      <span className="wf-label">Log de execução</span>
                      <button className="wf-icon-btn" onClick={() => setShowExecLog(false)}>
                        <X size={13} />
                      </button>
                    </div>
                    <div className="wf-exec-entries">
                      {execLog.map((entry, i) => (
                        <div key={i} className={`wf-exec-entry wf-exec-${entry.status}`}>
                          <div className="wf-exec-header">
                            <span className="wf-exec-label">{entry.nodeLabel}</span>
                            <span className={`wf-exec-badge wf-exec-badge-${entry.status}`}>
                              {entry.status === 'running' && <Loader2 size={10} className="wf-spin" />}
                              {entry.status === 'done' && <CheckCircle2 size={10} />}
                              {entry.status === 'error' && <AlertCircle size={10} />}
                              {entry.status === 'skipped' && <ChevronRight size={10} />}
                              {entry.status}
                            </span>
                          </div>
                          {entry.output && <p className="wf-exec-output">{entry.output.slice(0, 300)}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* RIGHT CONFIG PANEL */}
          {activeWorkflow && selectedNode && (
            <div className="wf-config-panel">
              <div className="wf-config-header">
                <span className="wf-label">Configurar nó</span>
                <button className="wf-icon-btn" onClick={() => setSelectedNodeId(null)}>
                  <X size={14} />
                </button>
              </div>

              <div className="wf-config-field">
                <label className="wf-config-label">Label</label>
                <input
                  className="wf-config-input"
                  value={selectedNode.label}
                  onChange={e => updateNode(selectedNode.id, { label: e.target.value })}
                  placeholder="Nome do nó"
                />
              </div>

              {/* Trigger config */}
              {selectedNode.type === 'trigger' && (
                <>
                  <div className="wf-config-field">
                    <label className="wf-config-label">Tipo de gatilho</label>
                    <div className="wf-config-select-wrap">
                      <select
                        className="wf-config-select"
                        value={selectedNode.config.triggerType}
                        onChange={e => updateNodeConfig(selectedNode.id, { triggerType: e.target.value })}
                      >
                        <option value="manual">Manual</option>
                        <option value="file_watch">Observar arquivo</option>
                        <option value="schedule">Agendamento</option>
                      </select>
                      <ChevronDown size={12} className="wf-select-icon" />
                    </div>
                  </div>
                  {selectedNode.config.triggerType === 'file_watch' && (
                    <div className="wf-config-field">
                      <label className="wf-config-label">Caminho do arquivo</label>
                      <input
                        className="wf-config-input"
                        value={selectedNode.config.watchPath}
                        onChange={e => updateNodeConfig(selectedNode.id, { watchPath: e.target.value })}
                        placeholder="/caminho/para/arquivo"
                      />
                    </div>
                  )}
                  {selectedNode.config.triggerType === 'schedule' && (
                    <div className="wf-config-field">
                      <label className="wf-config-label">Agendamento (cron)</label>
                      <input
                        className="wf-config-input"
                        value={selectedNode.config.schedule}
                        onChange={e => updateNodeConfig(selectedNode.id, { schedule: e.target.value })}
                        placeholder="0 * * * *"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Prompt config */}
              {selectedNode.type === 'prompt' && (
                <>
                  <div className="wf-config-field">
                    <label className="wf-config-label">Template do prompt</label>
                    <textarea
                      className="wf-config-textarea"
                      value={selectedNode.config.promptTemplate}
                      onChange={e => updateNodeConfig(selectedNode.id, { promptTemplate: e.target.value })}
                      placeholder="Use {{input}} para referenciar a saída anterior"
                      rows={4}
                    />
                    <p className="wf-config-hint">Use {'{{input}}'} para o output do nó anterior</p>
                  </div>
                  <div className="wf-config-field">
                    <label className="wf-config-label">Provedor</label>
                    <div className="wf-config-select-wrap">
                      <select
                        className="wf-config-select"
                        value={selectedNode.config.provider}
                        onChange={e => updateNodeConfig(selectedNode.id, { provider: e.target.value })}
                      >
                        {(['ollama','openai','gemini','anthropic','openrouter','modal'] as const).map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="wf-select-icon" />
                    </div>
                  </div>
                  <div className="wf-config-field">
                    <label className="wf-config-label">Modelo</label>
                    <input
                      className="wf-config-input"
                      value={selectedNode.config.model}
                      onChange={e => updateNodeConfig(selectedNode.id, { model: e.target.value })}
                      placeholder="llama3"
                    />
                  </div>
                </>
              )}

              {/* Tool config */}
              {selectedNode.type === 'tool' && (
                <>
                  <div className="wf-config-field">
                    <label className="wf-config-label">Ferramenta</label>
                    <div className="wf-config-select-wrap">
                      <select
                        className="wf-config-select"
                        value={selectedNode.config.toolName}
                        onChange={e => updateNodeConfig(selectedNode.id, { toolName: e.target.value, params: {} })}
                      >
                        <option value="exec_command">Executar comando</option>
                        <option value="web_search">Busca na web</option>
                        <option value="read_file">Ler arquivo</option>
                        <option value="write_file">Escrever arquivo</option>
                      </select>
                      <ChevronDown size={12} className="wf-select-icon" />
                    </div>
                  </div>
                  {selectedNode.config.toolName === 'exec_command' && (
                    <div className="wf-config-field">
                      <label className="wf-config-label">Comando</label>
                      <input
                        className="wf-config-input"
                        value={selectedNode.config.params?.command || ''}
                        onChange={e => updateNodeConfig(selectedNode.id, { params: { ...selectedNode.config.params, command: e.target.value } })}
                        placeholder="echo hello"
                      />
                    </div>
                  )}
                  {selectedNode.config.toolName === 'web_search' && (
                    <div className="wf-config-field">
                      <label className="wf-config-label">Query (ou deixe vazio para usar input)</label>
                      <input
                        className="wf-config-input"
                        value={selectedNode.config.params?.query || ''}
                        onChange={e => updateNodeConfig(selectedNode.id, { params: { ...selectedNode.config.params, query: e.target.value } })}
                        placeholder="{{input}}"
                      />
                    </div>
                  )}
                  {(selectedNode.config.toolName === 'read_file' || selectedNode.config.toolName === 'write_file') && (
                    <div className="wf-config-field">
                      <label className="wf-config-label">Caminho do arquivo</label>
                      <input
                        className="wf-config-input"
                        value={selectedNode.config.params?.filePath || ''}
                        onChange={e => updateNodeConfig(selectedNode.id, { params: { ...selectedNode.config.params, filePath: e.target.value } })}
                        placeholder="/caminho/arquivo.txt"
                      />
                    </div>
                  )}
                  {selectedNode.config.toolName === 'write_file' && (
                    <div className="wf-config-field">
                      <label className="wf-config-label">Conteúdo (ou vazio para usar input)</label>
                      <textarea
                        className="wf-config-textarea"
                        value={selectedNode.config.params?.content || ''}
                        onChange={e => updateNodeConfig(selectedNode.id, { params: { ...selectedNode.config.params, content: e.target.value } })}
                        placeholder="{{input}}"
                        rows={3}
                      />
                    </div>
                  )}
                </>
              )}

              {/* Condition config */}
              {selectedNode.type === 'condition' && (
                <div className="wf-config-field">
                  <label className="wf-config-label">Expressão (contém)</label>
                  <input
                    className="wf-config-input"
                    value={selectedNode.config.expression}
                    onChange={e => updateNodeConfig(selectedNode.id, { expression: e.target.value })}
                    placeholder="texto a buscar no output anterior"
                  />
                  <p className="wf-config-hint">Verifica se o output do nó anterior contém este texto</p>
                </div>
              )}

              {/* Output config */}
              {selectedNode.type === 'output' && (
                <>
                  <div className="wf-config-field">
                    <label className="wf-config-label">Destino</label>
                    <div className="wf-config-select-wrap">
                      <select
                        className="wf-config-select"
                        value={selectedNode.config.destination}
                        onChange={e => updateNodeConfig(selectedNode.id, { destination: e.target.value })}
                      >
                        <option value="chat">Chat</option>
                        <option value="clipboard">Área de transferência</option>
                        <option value="file">Arquivo</option>
                      </select>
                      <ChevronDown size={12} className="wf-select-icon" />
                    </div>
                  </div>
                  {selectedNode.config.destination === 'file' && (
                    <div className="wf-config-field">
                      <label className="wf-config-label">Caminho do arquivo</label>
                      <input
                        className="wf-config-input"
                        value={selectedNode.config.filePath}
                        onChange={e => updateNodeConfig(selectedNode.id, { filePath: e.target.value })}
                        placeholder="/caminho/saida.txt"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="wf-config-delete">
                <button className="wf-delete-node-btn" onClick={() => deleteNode(selectedNode.id)}>
                  <Trash2 size={12} /> Excluir nó
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .wf-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(6px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .wf-modal {
          background: var(--bg-secondary, #13131f);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 16px;
          width: 100%;
          max-width: 1200px;
          height: 88vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0,0,0,0.7);
        }
        .wf-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
          flex-shrink: 0;
        }
        .wf-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .wf-icon-wrap {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          background: linear-gradient(135deg, #f97316, #a855f7);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }
        .wf-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary, #f1f1f1);
          margin: 0;
        }
        .wf-subtitle {
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin: 0;
        }
        .wf-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .wf-connect-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 7px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: transparent;
          color: var(--text-secondary, #888);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .wf-connect-active {
          border-color: rgba(34,197,94,0.4);
          background: rgba(34,197,94,0.08);
          color: #22c55e;
        }
        .wf-run-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 7px;
          border: none;
          background: linear-gradient(135deg, #f97316, #a855f7);
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .wf-run-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .wf-save-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 7px;
          border: 1px solid rgba(168,85,247,0.3);
          background: rgba(168,85,247,0.08);
          color: #a855f7;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .wf-save-btn:hover { background: rgba(168,85,247,0.15); }
        .wf-icon-btn {
          background: none;
          border: none;
          color: var(--text-secondary, #888);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s, background 0.15s;
        }
        .wf-icon-btn:hover {
          color: var(--text-primary, #f1f1f1);
          background: rgba(255,255,255,0.06);
        }
        /* Body */
        .wf-body {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        /* Sidebar */
        .wf-sidebar {
          width: 200px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
          overflow: hidden;
        }
        .wf-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 12px 8px;
          flex-shrink: 0;
        }
        .wf-sidebar-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary, #888);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .wf-new-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 6px;
          border: none;
          background: rgba(249,115,22,0.15);
          color: #f97316;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .wf-new-btn:hover { background: rgba(249,115,22,0.25); }
        .wf-sidebar-loading {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px;
          font-size: 12px;
          color: var(--text-secondary, #888);
        }
        .wf-sidebar-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 24px 12px;
          color: var(--text-secondary, #888);
          text-align: center;
          opacity: 0.5;
        }
        .wf-sidebar-empty p { margin: 0; font-size: 13px; }
        .wf-sidebar-empty span { font-size: 11px; }
        .wf-workflow-list {
          flex: 1;
          overflow-y: auto;
          padding: 0 8px 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .wf-workflow-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s;
        }
        .wf-workflow-item:hover { background: rgba(255,255,255,0.04); }
        .wf-workflow-active {
          background: rgba(249,115,22,0.08) !important;
          border-color: rgba(249,115,22,0.2) !important;
        }
        .wf-workflow-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .wf-workflow-name {
          font-size: 12px;
          color: var(--text-primary, #f1f1f1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wf-workflow-meta {
          font-size: 10px;
          color: var(--text-secondary, #888);
        }
        .wf-delete-wf-btn {
          background: none;
          border: none;
          color: rgba(239,68,68,0.4);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          flex-shrink: 0;
          transition: color 0.15s;
        }
        .wf-delete-wf-btn:hover { color: #ef4444; }
        /* Canvas area */
        .wf-canvas-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }
        .wf-canvas-placeholder {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          color: var(--text-secondary, #888);
          opacity: 0.5;
        }
        .wf-canvas-placeholder p { margin: 0; font-size: 15px; }
        .wf-create-first-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #f97316, #a855f7);
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          opacity: 2;
        }
        .wf-canvas-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.06));
          flex-shrink: 0;
        }
        .wf-name-display {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          color: var(--text-primary, #f1f1f1);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 6px;
          border-radius: 5px;
          transition: background 0.15s;
        }
        .wf-name-display:hover { background: rgba(255,255,255,0.05); }
        .wf-name-edit {
          background: var(--bg-primary, #0d0d17);
          border: 1px solid #f97316;
          border-radius: 6px;
          color: var(--text-primary, #f1f1f1);
          font-size: 13px;
          font-weight: 600;
          padding: 4px 8px;
          width: 200px;
        }
        .wf-name-edit:focus { outline: none; }
        .wf-canvas-hint {
          font-size: 11px;
          color: var(--text-secondary, #888);
          opacity: 0.7;
        }
        /* Palette */
        .wf-palette {
          display: flex;
          gap: 6px;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.06));
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .wf-palette-node {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid;
          background: rgba(255,255,255,0.03);
          cursor: grab;
          user-select: none;
          transition: background 0.15s;
        }
        .wf-palette-node:hover { background: rgba(255,255,255,0.07); }
        .wf-palette-label {
          font-size: 11px;
          color: var(--text-secondary, #888);
          text-transform: capitalize;
        }
        /* SVG Canvas */
        .wf-canvas-container {
          flex: 1;
          position: relative;
          overflow: hidden;
          background: var(--bg-primary, #0d0d17);
          background-image:
            radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 24px 24px;
          cursor: grab;
        }
        .wf-canvas-container:active { cursor: grabbing; }
        .wf-svg {
          width: 100%;
          height: 100%;
          position: absolute;
          inset: 0;
        }
        /* Nodes */
        .wf-node {
          width: 160px;
          border-radius: 10px;
          border: 1.5px solid;
          background: var(--bg-secondary, #13131f);
          cursor: move;
          user-select: none;
          overflow: hidden;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          transition: box-shadow 0.15s;
        }
        .wf-node:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.6); }
        .wf-node-selected {
          box-shadow: 0 0 0 2px currentColor, 0 6px 24px rgba(0,0,0,0.5) !important;
        }
        .wf-node-connect-from {
          box-shadow: 0 0 0 2px #22c55e, 0 6px 24px rgba(34,197,94,0.2) !important;
        }
        .wf-node-header {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 8px;
        }
        .wf-node-type {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          flex: 1;
        }
        .wf-node-delete {
          background: none;
          border: none;
          color: rgba(255,255,255,0.25);
          cursor: pointer;
          padding: 1px;
          display: flex;
          align-items: center;
          border-radius: 3px;
          transition: color 0.15s;
        }
        .wf-node-delete:hover { color: #ef4444; }
        .wf-node-label {
          padding: 4px 8px 7px;
          font-size: 12px;
          color: var(--text-primary, #f1f1f1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Exec Log */
        .wf-exec-log {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: var(--bg-secondary, #13131f);
          border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));
          max-height: 200px;
          display: flex;
          flex-direction: column;
        }
        .wf-exec-log-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.06));
          flex-shrink: 0;
        }
        .wf-exec-entries {
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 12px;
        }
        .wf-exec-entry {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 6px 8px;
          border-radius: 6px;
          background: rgba(255,255,255,0.02);
        }
        .wf-exec-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .wf-exec-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary, #f1f1f1);
        }
        .wf-exec-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 10px;
        }
        .wf-exec-badge-running { background: rgba(249,115,22,0.15); color: #f97316; }
        .wf-exec-badge-done { background: rgba(34,197,94,0.15); color: #22c55e; }
        .wf-exec-badge-error { background: rgba(239,68,68,0.15); color: #ef4444; }
        .wf-exec-badge-skipped { background: rgba(255,255,255,0.06); color: #888; }
        .wf-exec-output {
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin: 0;
          font-family: monospace;
          white-space: pre-wrap;
          word-break: break-all;
        }
        /* Config panel */
        .wf-config-panel {
          width: 240px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px;
          border-left: 1px solid var(--border-color, rgba(255,255,255,0.08));
          overflow-y: auto;
        }
        .wf-config-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .wf-config-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .wf-config-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-secondary, #888);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .wf-config-input {
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 7px;
          color: var(--text-primary, #f1f1f1);
          padding: 7px 10px;
          font-size: 12px;
          width: 100%;
          box-sizing: border-box;
        }
        .wf-config-input:focus { outline: none; border-color: #f97316; }
        .wf-config-textarea {
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 7px;
          color: var(--text-primary, #f1f1f1);
          padding: 7px 10px;
          font-size: 12px;
          width: 100%;
          box-sizing: border-box;
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
        }
        .wf-config-textarea:focus { outline: none; border-color: #f97316; }
        .wf-config-select-wrap {
          position: relative;
        }
        .wf-config-select {
          width: 100%;
          appearance: none;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 7px;
          color: var(--text-primary, #f1f1f1);
          padding: 7px 26px 7px 10px;
          font-size: 12px;
        }
        .wf-config-select:focus { outline: none; border-color: #f97316; }
        .wf-select-icon {
          position: absolute;
          right: 7px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: var(--text-secondary, #888);
        }
        .wf-config-hint {
          font-size: 10px;
          color: var(--text-secondary, #888);
          margin: 0;
          line-height: 1.4;
        }
        .wf-config-delete {
          margin-top: auto;
          padding-top: 8px;
          border-top: 1px solid var(--border-color, rgba(255,255,255,0.06));
        }
        .wf-delete-node-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          border-radius: 7px;
          border: 1px solid rgba(239,68,68,0.25);
          background: transparent;
          color: #ef4444;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .wf-delete-node-btn:hover { background: rgba(239,68,68,0.1); }
        .wf-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary, #888);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .wf-spin {
          animation: wf-rotate 1s linear infinite;
        }
        @keyframes wf-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
