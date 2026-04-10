import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Play, Pause, Square, Bot, AlertTriangle, CheckCircle2,
  Loader2, AlertCircle, Eye, Target, ChevronDown, Shield, Zap,
  MousePointer, Keyboard, Clock, Monitor, StepForward
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

interface ORIONProps {
  settings: AppSettings
  onClose: () => void
}

interface OrionAction {
  id: string
  type: 'screenshot' | 'analyze' | 'move_mouse' | 'click' | 'type_text' | 'key_press' | 'wait' | 'scroll' | 'done'
  description: string
  params: Record<string, any>
  status: 'pending' | 'running' | 'done' | 'error'
  output?: string
  timestamp: number
}

interface OrionSession {
  id: string
  goal: string
  actions: OrionAction[]
  status: 'idle' | 'running' | 'paused' | 'done' | 'stopped'
  startedAt?: number
}

interface PendingAction {
  type: string
  params: Record<string, any>
  reasoning: string
}

const ORION_SYSTEM_PROMPT = `Você é ORION, um agente de controle de computador. Analise a captura de tela e decida a próxima ação para atingir o objetivo.
Responda SOMENTE com um JSON válido no formato:
{"type": "move_mouse|click|type_text|key_press|wait|done", "params": {...}, "reasoning": "..."}

Tipos de ação e seus parâmetros:
- move_mouse: {"x": number, "y": number}
- click: {"x": number, "y": number, "button": "left|right|double"}
- type_text: {"text": string}
- key_press: {"key": string} (use formato SendKeys: {ENTER}, {TAB}, {ESC}, {BACKSPACE}, etc)
- wait: {"ms": number}
- done: {} (quando o objetivo estiver completo)

Analise cuidadosamente o estado atual da tela antes de decidir.`

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

function getModel(settings: AppSettings): string {
  switch (settings.provider) {
    case 'openai': return settings.openaiModel
    case 'gemini': return settings.geminiModel
    case 'anthropic': return settings.anthropicModel
    case 'openrouter': return settings.openrouterModel
    case 'modal': return settings.modalModel
    default: return 'llava'
  }
}

function actionIcon(type: string) {
  switch (type) {
    case 'screenshot': return <Monitor size={13} />
    case 'analyze': return <Eye size={13} />
    case 'move_mouse': return <MousePointer size={13} />
    case 'click': return <MousePointer size={13} />
    case 'type_text': return <Keyboard size={13} />
    case 'key_press': return <Keyboard size={13} />
    case 'wait': return <Clock size={13} />
    case 'done': return <CheckCircle2 size={13} />
    default: return <Zap size={13} />
  }
}

function statusColor(status: OrionAction['status']): string {
  switch (status) {
    case 'done': return '#22c55e'
    case 'error': return '#ef4444'
    case 'running': return '#f97316'
    default: return '#888'
  }
}

function buildPowerShellCommand(action: PendingAction): string {
  switch (action.type) {
    case 'move_mouse': {
      const { x, y } = action.params
      return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`
    }
    case 'click': {
      const { x, y, button = 'left' } = action.params
      const btn = button === 'right' ? 2 : button === 'double' ? 1 : 1
      const dbl = button === 'double'
      return [
        `Add-Type -AssemblyName System.Windows.Forms`,
        `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`,
        `Add-Type -TypeDefinition @'`,
        `using System; using System.Runtime.InteropServices;`,
        `public class Mouse { [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int data, int extra); }`,
        `'@`,
        `[Mouse]::mouse_event(0x02, 0, 0, 0, 0)`,
        `[Mouse]::mouse_event(0x04, 0, 0, 0, 0)`,
        ...(dbl ? [`[Mouse]::mouse_event(0x02, 0, 0, 0, 0)`, `[Mouse]::mouse_event(0x04, 0, 0, 0, 0)`] : []),
      ].join('; ')
    }
    case 'type_text': {
      const text = (action.params.text || '').replace(/'/g, "''")
      return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text}')`
    }
    case 'key_press': {
      const key = action.params.key || '{ENTER}'
      return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}')`
    }
    case 'wait': {
      const ms = action.params.ms || 1000
      return `Start-Sleep -Milliseconds ${ms}`
    }
    default:
      return 'echo "no-op"'
  }
}

export default function ORION({ settings, onClose }: ORIONProps) {
  const [goal, setGoal] = useState('')
  const [session, setSession] = useState<OrionSession | null>(null)
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null)
  const [maxSteps, setMaxSteps] = useState(20)
  const [supervisedMode, setSupervisedMode] = useState(true)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stepCount, setStepCount] = useState(0)
  const [showMaxConfig, setShowMaxConfig] = useState(false)

  const sessionRef = useRef<OrionSession | null>(null)
  const runningRef = useRef(false)
  const screenshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const actionsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // Scroll to bottom of action log on new actions
  useEffect(() => {
    actionsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.actions.length])

  // Live screenshot polling during active session
  useEffect(() => {
    if (session?.status === 'running') {
      screenshotIntervalRef.current = setInterval(async () => {
        try {
          const r = await window.electron.orionCapture()
          if (r.base64) setLiveScreenshot(r.base64)
        } catch {}
      }, 3000)
    } else {
      if (screenshotIntervalRef.current) {
        clearInterval(screenshotIntervalRef.current)
        screenshotIntervalRef.current = null
      }
    }
    return () => {
      if (screenshotIntervalRef.current) clearInterval(screenshotIntervalRef.current)
    }
  }, [session?.status])

  const addAction = useCallback((action: OrionAction) => {
    setSession(prev => {
      if (!prev) return prev
      return { ...prev, actions: [...prev.actions, action] }
    })
  }, [])

  const updateAction = useCallback((id: string, updates: Partial<OrionAction>) => {
    setSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        actions: prev.actions.map(a => a.id === id ? { ...a, ...updates } : a)
      }
    })
  }, [])

  const captureAndAnalyze = async (): Promise<{ base64: string; analysis: string } | null> => {
    // Capture
    const captureResult = await window.electron.orionCapture()
    if (captureResult.error || !captureResult.base64) {
      throw new Error(captureResult.error ?? 'Falha ao capturar tela')
    }
    setLiveScreenshot(captureResult.base64)

    // Analyze with vision
    const currentSession = sessionRef.current
    if (!currentSession) return null

    const visionResult = await window.electron.visionChat({
      provider: settings.provider,
      apiKey: getApiKey(settings),
      model: getModel(settings),
      prompt: `OBJETIVO: ${currentSession.goal}\n\n${ORION_SYSTEM_PROMPT}`,
      imageBase64: captureResult.base64,
      modalHostname: settings.modalHostname,
    })

    if (visionResult.error) throw new Error(visionResult.error)

    return { base64: captureResult.base64, analysis: visionResult.response ?? '' }
  }

  const parseAction = (raw: string): PendingAction => {
    // Try to extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Resposta do AI não contém JSON válido')
    return JSON.parse(jsonMatch[0]) as PendingAction
  }

  const executeAction = async (action: PendingAction): Promise<string> => {
    if (action.type === 'done') return 'Objetivo concluído!'
    const cmd = buildPowerShellCommand(action)
    const result = await window.electron.execCommand(`powershell -Command "${cmd.replace(/"/g, '\\"')}"`)
    if (result.error) throw new Error(result.error)
    return result.stdout || result.stderr || 'OK'
  }

  const runLoop = async (sess: OrionSession) => {
    runningRef.current = true
    let steps = 0

    while (runningRef.current && steps < maxSteps) {
      const current = sessionRef.current
      if (!current || current.status !== 'running') break

      steps++
      setStepCount(steps)
      setError(null)

      // Screenshot + analyze action
      const captureId = `capture-${Date.now()}`
      addAction({
        id: captureId,
        type: 'screenshot',
        description: `Capturando tela (passo ${steps})`,
        params: {},
        status: 'running',
        timestamp: Date.now(),
      })

      let analysis: { base64: string; analysis: string } | null = null
      try {
        analysis = await captureAndAnalyze()
        updateAction(captureId, { status: 'done', output: 'Captura concluída' })
      } catch (e: any) {
        updateAction(captureId, { status: 'error', output: e?.message })
        setError(e?.message ?? 'Erro ao capturar')
        break
      }

      if (!analysis) break

      // Parse the action from AI response
      let parsed: PendingAction
      try {
        parsed = parseAction(analysis.analysis)
      } catch (e: any) {
        setError('Erro ao interpretar ação da IA: ' + e?.message)
        break
      }

      // If done
      if (parsed.type === 'done') {
        const doneId = `done-${Date.now()}`
        addAction({
          id: doneId,
          type: 'done',
          description: 'Objetivo concluído!',
          params: {},
          status: 'done',
          output: parsed.reasoning,
          timestamp: Date.now(),
        })
        setSession(prev => prev ? { ...prev, status: 'done' } : prev)
        runningRef.current = false
        return
      }

      // Supervised mode: wait for approval
      if (supervisedMode) {
        setPendingAction(parsed)
        setSession(prev => prev ? { ...prev, status: 'paused' } : prev)
        runningRef.current = false
        return
      }

      // Execute action
      const execId = `exec-${Date.now()}`
      addAction({
        id: execId,
        type: parsed.type as any,
        description: parsed.reasoning || `Executando ${parsed.type}`,
        params: parsed.params,
        status: 'running',
        timestamp: Date.now(),
      })

      try {
        const output = await executeAction(parsed)
        updateAction(execId, { status: 'done', output })
      } catch (e: any) {
        updateAction(execId, { status: 'error', output: e?.message })
        setError('Erro ao executar ação: ' + e?.message)
        break
      }

      // Small delay between steps
      await new Promise(r => setTimeout(r, 800))
    }

    if (steps >= maxSteps) {
      setError(`Limite de ${maxSteps} passos atingido.`)
      setSession(prev => prev ? { ...prev, status: 'stopped' } : prev)
    }
    runningRef.current = false
  }

  const handleStart = async () => {
    if (!goal.trim()) { setError('Digite o objetivo primeiro.'); return }
    const newSession: OrionSession = {
      id: Date.now().toString(),
      goal: goal.trim(),
      actions: [],
      status: 'running',
      startedAt: Date.now(),
    }
    setSession(newSession)
    setStepCount(0)
    setError(null)
    setPendingAction(null)
    // capture initial screenshot
    try {
      const r = await window.electron.orionCapture()
      if (r.base64) setLiveScreenshot(r.base64)
    } catch {}
    // Use a short delay to let state settle
    setTimeout(() => runLoop(newSession), 100)
  }

  const handleApprove = async () => {
    if (!pendingAction || !session) return
    const sess = { ...session, status: 'running' as const }
    setSession(sess)
    setPendingAction(null)
    runningRef.current = true

    // Execute the pending action
    const execId = `exec-${Date.now()}`
    addAction({
      id: execId,
      type: pendingAction.type as any,
      description: pendingAction.reasoning || `Executando ${pendingAction.type}`,
      params: pendingAction.params,
      status: 'running',
      timestamp: Date.now(),
    })

    try {
      const output = await executeAction(pendingAction)
      updateAction(execId, { status: 'done', output })
    } catch (e: any) {
      updateAction(execId, { status: 'error', output: e?.message })
      setError('Erro: ' + e?.message)
      setSession(prev => prev ? { ...prev, status: 'stopped' } : prev)
      runningRef.current = false
      return
    }

    // Continue loop
    await new Promise(r => setTimeout(r, 500))
    runLoop(sess)
  }

  const handleReject = () => {
    setPendingAction(null)
    setSession(prev => prev ? { ...prev, status: 'stopped' } : prev)
    runningRef.current = false
  }

  const handlePause = () => {
    runningRef.current = false
    setSession(prev => prev ? { ...prev, status: 'paused' } : prev)
  }

  const handleResume = () => {
    if (!session) return
    const resumed = { ...session, status: 'running' as const }
    setSession(resumed)
    runLoop(resumed)
  }

  const handleStop = () => {
    runningRef.current = false
    setSession(prev => prev ? { ...prev, status: 'stopped' } : prev)
    setPendingAction(null)
  }

  const handleReset = () => {
    runningRef.current = false
    setSession(null)
    setLiveScreenshot(null)
    setStepCount(0)
    setError(null)
    setPendingAction(null)
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => { window.removeEventListener('keydown', handleKey); runningRef.current = false }
  }, [onClose])

  const isRunning = session?.status === 'running'
  const isPaused = session?.status === 'paused'
  const isDone = session?.status === 'done' || session?.status === 'stopped'

  return (
    <div className="orion-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="orion-modal">
        {/* Header */}
        <div className="orion-header">
          <div className="orion-header-left">
            <div className="orion-icon-wrap">
              <Bot size={18} />
            </div>
            <div>
              <h2 className="orion-title">ORION</h2>
              <p className="orion-subtitle">Agente de Controle de Computador</p>
            </div>
          </div>
          <div className="orion-header-right">
            {session && !isDone && (
              <div className="orion-step-counter">
                Passo <strong>{stepCount}</strong> / {maxSteps}
              </div>
            )}
            <button
              className="orion-stop-emergency"
              onClick={handleStop}
              title="Parada de emergência"
            >
              <Square size={14} /> PARAR
            </button>
            <button className="orion-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="orion-body">
          {/* LEFT: Controls + Live screen */}
          <div className="orion-left">
            {/* Goal input */}
            {!session && (
              <div className="orion-section">
                <label className="orion-label">Objetivo</label>
                <textarea
                  className="orion-goal-input"
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder="Descreva o que o ORION deve fazer…&#10;Ex: Abrir o Notepad e escrever Olá Mundo"
                  rows={4}
                />
              </div>
            )}

            {session && (
              <div className="orion-goal-display">
                <Target size={13} />
                <span>{session.goal}</span>
              </div>
            )}

            {/* Config */}
            {!session && (
              <div className="orion-section">
                <div className="orion-config-row">
                  <button
                    className={`orion-supervised-btn ${supervisedMode ? 'orion-supervised-on' : ''}`}
                    onClick={() => setSupervisedMode(!supervisedMode)}
                  >
                    <Shield size={13} />
                    {supervisedMode ? 'Modo Supervisionado: ON' : 'Modo Supervisionado: OFF'}
                  </button>
                </div>
                <div className="orion-config-row">
                  <button
                    className="orion-config-minor"
                    onClick={() => setShowMaxConfig(!showMaxConfig)}
                  >
                    <ChevronDown size={12} />
                    Máx. passos: {maxSteps}
                  </button>
                  {showMaxConfig && (
                    <input
                      type="number"
                      className="orion-max-input"
                      value={maxSteps}
                      min={1}
                      max={100}
                      onChange={e => setMaxSteps(Number(e.target.value))}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="orion-controls">
              {!session && (
                <button className="orion-start-btn" onClick={handleStart}>
                  <Play size={15} /> Iniciar ORION
                </button>
              )}
              {session && !isDone && (
                <>
                  {isRunning && (
                    <button className="orion-control-btn orion-pause-btn" onClick={handlePause}>
                      <Pause size={14} /> Pausar
                    </button>
                  )}
                  {isPaused && !pendingAction && (
                    <button className="orion-control-btn orion-resume-btn" onClick={handleResume}>
                      <Play size={14} /> Retomar
                    </button>
                  )}
                </>
              )}
              {session && (
                <button className="orion-control-btn orion-reset-btn" onClick={handleReset}>
                  <StepForward size={14} /> Nova sessão
                </button>
              )}
            </div>

            {/* Pending action approval */}
            {pendingAction && (
              <div className="orion-pending-action">
                <div className="orion-pending-header">
                  <AlertTriangle size={14} />
                  <span>Ação proposta pela IA</span>
                </div>
                <div className="orion-pending-type">
                  {actionIcon(pendingAction.type)}
                  <strong>{pendingAction.type}</strong>
                  <span>{JSON.stringify(pendingAction.params)}</span>
                </div>
                {pendingAction.reasoning && (
                  <p className="orion-pending-reasoning">{pendingAction.reasoning}</p>
                )}
                <div className="orion-pending-btns">
                  <button className="orion-approve-btn" onClick={handleApprove}>
                    <CheckCircle2 size={13} /> Aprovar & Executar
                  </button>
                  <button className="orion-reject-btn" onClick={handleReject}>
                    <X size={13} /> Rejeitar
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="orion-error">
                <AlertCircle size={13} /> {error}
              </div>
            )}

            {/* Status badge */}
            {session && (
              <div className={`orion-status-badge orion-status-${session.status}`}>
                {session.status === 'running' && <Loader2 size={12} className="orion-spin" />}
                {session.status === 'done' && <CheckCircle2 size={12} />}
                {session.status === 'stopped' && <Square size={12} />}
                {session.status === 'paused' && <Pause size={12} />}
                {{
                  running: 'Executando…',
                  paused: 'Pausado',
                  done: 'Concluído!',
                  stopped: 'Parado',
                  idle: 'Aguardando',
                }[session.status]}
              </div>
            )}

            {/* Live screenshot */}
            <div className="orion-section">
              <label className="orion-label">
                Tela ao vivo {isRunning && '(atualiza a cada 3s)'}
              </label>
              <div className={`orion-screen-preview ${!liveScreenshot ? 'orion-screen-empty' : ''}`}>
                {liveScreenshot ? (
                  <img
                    src={`data:image/png;base64,${liveScreenshot}`}
                    alt="Tela ao vivo"
                    className="orion-screen-img"
                  />
                ) : (
                  <div className="orion-screen-placeholder">
                    <Monitor size={28} />
                    <p>Aguardando captura…</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Action log */}
          <div className="orion-right">
            <label className="orion-label">
              Log de ações {session ? `(${session.actions.length})` : ''}
            </label>

            {(!session || session.actions.length === 0) && (
              <div className="orion-log-empty">
                <Bot size={28} />
                <p>O log de ações aparecerá aqui</p>
                <span>Cada passo executado pelo ORION será registrado</span>
              </div>
            )}

            <div className="orion-action-log">
              {session?.actions.map(action => (
                <div key={action.id} className={`orion-action-item orion-action-${action.status}`}>
                  <div className="orion-action-header">
                    <div className="orion-action-icon" style={{ color: statusColor(action.status) }}>
                      {action.status === 'running'
                        ? <Loader2 size={13} className="orion-spin" />
                        : actionIcon(action.type)}
                    </div>
                    <div className="orion-action-info">
                      <span className="orion-action-type">{action.type}</span>
                      <span className="orion-action-desc">{action.description}</span>
                    </div>
                    <div
                      className="orion-action-status-dot"
                      style={{ background: statusColor(action.status) }}
                    />
                  </div>
                  {Object.keys(action.params).length > 0 && (
                    <div className="orion-action-params">
                      {JSON.stringify(action.params)}
                    </div>
                  )}
                  {action.output && (
                    <div className="orion-action-output">{action.output}</div>
                  )}
                </div>
              ))}
              <div ref={actionsEndRef} />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .orion-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(6px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .orion-modal {
          background: var(--bg-secondary, #13131f);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 16px;
          width: 100%;
          max-width: 1000px;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0,0,0,0.7);
        }
        .orion-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
          flex-shrink: 0;
        }
        .orion-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .orion-icon-wrap {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, #f97316, #a855f7);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }
        .orion-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary, #f1f1f1);
          margin: 0;
          letter-spacing: 0.05em;
        }
        .orion-subtitle {
          font-size: 12px;
          color: var(--text-secondary, #888);
          margin: 0;
        }
        .orion-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .orion-step-counter {
          font-size: 12px;
          color: var(--text-secondary, #888);
          padding: 4px 10px;
          border-radius: 20px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
        }
        .orion-stop-emergency {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 8px;
          border: 1px solid rgba(239,68,68,0.4);
          background: rgba(239,68,68,0.1);
          color: #ef4444;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          letter-spacing: 0.04em;
        }
        .orion-stop-emergency:hover {
          background: rgba(239,68,68,0.2);
          border-color: #ef4444;
        }
        .orion-icon-btn {
          background: none;
          border: none;
          color: var(--text-secondary, #888);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          transition: color 0.15s, background 0.15s;
        }
        .orion-icon-btn:hover {
          color: var(--text-primary, #f1f1f1);
          background: rgba(255,255,255,0.06);
        }
        .orion-body {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        .orion-left {
          width: 380px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
          border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
          overflow-y: auto;
        }
        .orion-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 16px;
          overflow: hidden;
        }
        .orion-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .orion-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary, #888);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .orion-goal-input {
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          color: var(--text-primary, #f1f1f1);
          padding: 10px;
          font-size: 13px;
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
        }
        .orion-goal-input:focus { outline: none; border-color: #f97316; }
        .orion-goal-display {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(249,115,22,0.08);
          border: 1px solid rgba(249,115,22,0.2);
          color: #f97316;
          font-size: 13px;
        }
        .orion-config-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .orion-supervised-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          border-radius: 8px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: transparent;
          color: var(--text-secondary, #888);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .orion-supervised-on {
          border-color: rgba(34,197,94,0.4);
          background: rgba(34,197,94,0.08);
          color: #22c55e;
        }
        .orion-config-minor {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: transparent;
          color: var(--text-secondary, #888);
          font-size: 12px;
          cursor: pointer;
        }
        .orion-max-input {
          width: 64px;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 6px;
          color: var(--text-primary, #f1f1f1);
          padding: 5px 8px;
          font-size: 13px;
        }
        .orion-max-input:focus { outline: none; border-color: #f97316; }
        .orion-controls {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .orion-start-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #f97316, #a855f7);
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
        }
        .orion-start-btn:hover { opacity: 0.9; transform: translateY(-1px); }
        .orion-control-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 8px;
          border: none;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .orion-pause-btn { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
        .orion-resume-btn { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
        .orion-reset-btn { background: rgba(255,255,255,0.05); color: var(--text-secondary, #888); border: 1px solid var(--border-color, rgba(255,255,255,0.08)); }
        .orion-pending-action {
          padding: 12px;
          border-radius: 10px;
          background: rgba(251,191,36,0.06);
          border: 1px solid rgba(251,191,36,0.2);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .orion-pending-header {
          display: flex;
          align-items: center;
          gap: 7px;
          color: #fbbf24;
          font-size: 12px;
          font-weight: 600;
        }
        .orion-pending-type {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          color: var(--text-primary, #f1f1f1);
          background: rgba(255,255,255,0.04);
          padding: 6px 8px;
          border-radius: 6px;
        }
        .orion-pending-type span {
          color: var(--text-secondary, #888);
          font-family: monospace;
          font-size: 11px;
        }
        .orion-pending-reasoning {
          font-size: 12px;
          color: var(--text-secondary, #888);
          margin: 0;
          line-height: 1.5;
        }
        .orion-pending-btns {
          display: flex;
          gap: 8px;
        }
        .orion-approve-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 7px 12px;
          border-radius: 8px;
          border: none;
          background: rgba(34,197,94,0.15);
          color: #22c55e;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid rgba(34,197,94,0.3);
          transition: background 0.15s;
        }
        .orion-approve-btn:hover { background: rgba(34,197,94,0.25); }
        .orion-reject-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 7px 12px;
          border-radius: 8px;
          border: 1px solid rgba(239,68,68,0.2);
          background: transparent;
          color: #ef4444;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .orion-reject-btn:hover { background: rgba(239,68,68,0.1); }
        .orion-error {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          padding: 9px 12px;
          border-radius: 8px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.2);
          color: #ef4444;
          font-size: 12px;
        }
        .orion-status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          width: fit-content;
        }
        .orion-status-running { background: rgba(249,115,22,0.1); color: #f97316; border: 1px solid rgba(249,115,22,0.3); }
        .orion-status-paused { background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
        .orion-status-done { background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
        .orion-status-stopped { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
        .orion-status-idle { background: rgba(255,255,255,0.05); color: #888; border: 1px solid rgba(255,255,255,0.08); }
        .orion-screen-preview {
          height: 180px;
          border-radius: 8px;
          overflow: hidden;
          background: var(--bg-primary, #0d0d17);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .orion-screen-empty {
          border: 2px dashed var(--border-color, rgba(255,255,255,0.08));
        }
        .orion-screen-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .orion-screen-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary, #888);
        }
        .orion-screen-placeholder p { margin: 0; font-size: 13px; }
        /* Action log */
        .orion-action-log {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-right: 4px;
        }
        .orion-log-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-secondary, #888);
          opacity: 0.5;
          text-align: center;
        }
        .orion-log-empty p { margin: 0; font-size: 14px; }
        .orion-log-empty span { font-size: 12px; }
        .orion-action-item {
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.06));
          transition: border-color 0.15s;
        }
        .orion-action-running { border-color: rgba(249,115,22,0.3); }
        .orion-action-done { border-color: rgba(34,197,94,0.15); }
        .orion-action-error { border-color: rgba(239,68,68,0.25); background: rgba(239,68,68,0.04); }
        .orion-action-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .orion-action-icon {
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }
        .orion-action-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .orion-action-type {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-primary, #f1f1f1);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .orion-action-desc {
          font-size: 12px;
          color: var(--text-secondary, #888);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .orion-action-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .orion-action-params {
          margin-top: 5px;
          font-size: 11px;
          font-family: monospace;
          color: var(--text-secondary, #888);
          background: rgba(255,255,255,0.03);
          border-radius: 4px;
          padding: 4px 6px;
          word-break: break-all;
        }
        .orion-action-output {
          margin-top: 4px;
          font-size: 11px;
          color: #22c55e;
          font-family: monospace;
          padding: 3px 6px;
          border-radius: 4px;
          background: rgba(34,197,94,0.05);
        }
        .orion-spin {
          animation: orion-rotate 1s linear infinite;
        }
        @keyframes orion-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
