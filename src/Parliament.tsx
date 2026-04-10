import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Play, Copy, Loader2, CheckCircle2, AlertCircle, Users, Scale, ChevronDown, RefreshCw, Download } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AppSettings } from './Settings'
import type { Provider } from './Settings'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParliamentRoleConfig {
  id: string
  name: string
  emoji: string
  provider: Provider
  model: string
  color: string
}

interface RoleResult {
  roleId: string
  roleName: string
  emoji: string
  response: string
  error?: string
  status: 'idle' | 'running' | 'done' | 'error'
  duration?: number
}

interface ParliamentProps {
  settings: AppSettings
  ollamaModels: string[]
  onClose: () => void
  onInsertToChat: (text: string) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMd(text: string): string {
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html)
}

function getModelForProvider(provider: Provider, settings: AppSettings, ollamaModels: string[]): string {
  switch (provider) {
    case 'ollama': return ollamaModels[0] || 'llama3'
    case 'openai': return settings.openaiModel
    case 'gemini': return settings.geminiModel
    case 'anthropic': return settings.anthropicModel
    case 'openrouter': return settings.openrouterModel
    case 'modal': return settings.modalModel
    default: return ''
  }
}

function getApiKeyForProvider(provider: Provider, settings: AppSettings): string {
  switch (provider) {
    case 'openai': return settings.openaiApiKey
    case 'gemini': return settings.geminiApiKey
    case 'anthropic': return settings.anthropicApiKey
    case 'openrouter': return settings.openrouterApiKey
    case 'modal': return settings.modalApiKey
    default: return ''
  }
}

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'ollama', label: 'Ollama' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'modal', label: 'Modal' },
]

const DEFAULT_ROLES: Omit<ParliamentRoleConfig, 'provider' | 'model'>[] = [
  { id: 'arquiteto',    name: 'Arquiteto',          emoji: '🏗️', color: '#6366f1' },
  { id: 'implementador',name: 'Implementador',       emoji: '💻', color: '#22c55e' },
  { id: 'seguranca',    name: 'Revisor de Segurança',emoji: '🔒', color: '#ef4444' },
  { id: 'testador',     name: 'Testador',             emoji: '🧪', color: '#f59e0b' },
  { id: 'diabo',        name: 'Advogado do Diabo',   emoji: '😈', color: '#a855f7' },
]

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ParliamentMode({ settings, ollamaModels, onClose, onInsertToChat }: ParliamentProps) {
  const defaultProvider: Provider = settings.provider === 'ollama' ? 'ollama' : settings.provider

  // ── State ──
  const [problem, setProblem] = useState('')
  const [phase, setPhase] = useState<'config' | 'running' | 'done'>('config')
  const [roles, setRoles] = useState<ParliamentRoleConfig[]>(() =>
    DEFAULT_ROLES.map(r => ({
      ...r,
      provider: defaultProvider,
      model: getModelForProvider(defaultProvider, settings, ollamaModels)
    }))
  )
  const [coordinator, setCoordinator] = useState<ParliamentRoleConfig>({
    id: 'coordenador', name: 'Coordenador', emoji: '🎯', color: '#f97316',
    provider: defaultProvider,
    model: getModelForProvider(defaultProvider, settings, ollamaModels)
  })
  const [roleResults, setRoleResults] = useState<Map<string, RoleResult>>(new Map())
  const [coordinatorResult, setCoordinatorResult] = useState('')
  const [coordinatorRunning, setCoordinatorRunning] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set(['arquiteto', 'implementador', 'seguranca', 'testador', 'diabo']))
  const [activeTab, setActiveTab] = useState<'roles' | 'synthesis'>('roles')
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Timer ──
  useEffect(() => {
    if (phase === 'running') {
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [phase])

  // ── Listen for role-done events from main process ──
  useEffect(() => {
    if (!window.electron.onParliamentRoleDone) return
    const unsub = window.electron.onParliamentRoleDone((result: any) => {
      setRoleResults(prev => {
        const next = new Map(prev)
        next.set(result.roleId, {
          roleId: result.roleId,
          roleName: result.roleName,
          emoji: result.emoji,
          response: result.response || '',
          error: result.error,
          status: result.error ? 'error' : 'done',
          duration: Math.floor((Date.now() - startTimeRef.current) / 1000)
        })
        return next
      })
    })
    return unsub
  }, [])

  // ── Listen for coordinator-done events ──
  useEffect(() => {
    if (!window.electron.onParliamentCoordinatorDone) return
    const unsub = window.electron.onParliamentCoordinatorDone((result: any) => {
      setCoordinatorResult(result.response || '')
      setCoordinatorRunning(false)
      setPhase('done')
      setActiveTab('synthesis')
    })
    return unsub
  }, [])

  // ── Update model when provider changes for a role ──
  const updateRoleProvider = useCallback((roleId: string, provider: Provider) => {
    const model = getModelForProvider(provider, settings, ollamaModels)
    setRoles(prev => prev.map(r => r.id === roleId ? { ...r, provider, model } : r))
  }, [settings, ollamaModels])

  const updateCoordinatorProvider = useCallback((provider: Provider) => {
    const model = getModelForProvider(provider, settings, ollamaModels)
    setCoordinator(prev => ({ ...prev, provider, model }))
  }, [settings, ollamaModels])

  // ── Start Debate ──
  const startDebate = useCallback(async () => {
    if (!problem.trim()) return
    setPhase('running')
    setRoleResults(new Map(
      roles.map(r => [r.id, { roleId: r.id, roleName: r.name, emoji: r.emoji, response: '', status: 'running' }])
    ))
    setCoordinatorResult('')
    setCoordinatorRunning(false)
    setElapsedTime(0)
    setActiveTab('roles')

    const rolesPayload = roles.map(r => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      provider: r.provider,
      model: r.model,
      apiKey: getApiKeyForProvider(r.provider, settings),
      modalHostname: settings.modalHostname
    }))

    const coordinatorPayload = {
      id: coordinator.id,
      name: coordinator.name,
      emoji: coordinator.emoji,
      provider: coordinator.provider,
      model: coordinator.model,
      apiKey: getApiKeyForProvider(coordinator.provider, settings),
      modalHostname: settings.modalHostname
    }

    try {
      setCoordinatorRunning(false)
      // Start parallel debate — backend will fire role-done events, then coordinator-done
      window.electron.parliamentDebate({
        problem: problem.trim(),
        roles: rolesPayload,
        coordinator: coordinatorPayload
      }).then((res: any) => {
        // Coordinator runs after roles complete — handle via event or fallback here
        if (res?.coordinator && !coordinatorResult) {
          setCoordinatorResult(res.coordinator)
          setCoordinatorRunning(false)
          setPhase('done')
          setActiveTab('synthesis')
        }
      }).catch((err: any) => {
        console.error('Parliament debate error:', err)
        setPhase('done')
      })

      // Show coordinator as running after 2s (optimistic)
      setTimeout(() => {
        setCoordinatorRunning(prev => phase === 'running' ? true : prev)
      }, 2000)
    } catch (err) {
      console.error(err)
      setPhase('done')
    }
  }, [problem, roles, coordinator, settings, coordinatorResult, phase])

  const reset = () => {
    setPhase('config')
    setRoleResults(new Map())
    setCoordinatorResult('')
    setCoordinatorRunning(false)
    setElapsedTime(0)
  }

  const copyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {}
  }

  const exportToChat = () => {
    let output = `# 🏛️ Parliament Mode — Debate\n\n**Problema:** ${problem}\n\n`
    roleResults.forEach(r => {
      output += `---\n## ${r.emoji} ${r.roleName}\n\n${r.response}\n\n`
    })
    if (coordinatorResult) {
      output += `---\n## 🎯 Síntese do Coordenador\n\n${coordinatorResult}`
    }
    onInsertToChat(output)
    onClose()
  }

  const toggleExpanded = (roleId: string) => {
    setExpandedRoles(prev => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return next
    })
  }

  const doneCount = Array.from(roleResults.values()).filter(r => r.status === 'done' || r.status === 'error').length
  const totalRoles = roles.length

  // ── Render ──
  return (
    <div className="parliament-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="parliament-modal">

        {/* ─── Header ─── */}
        <div className="parliament-header">
          <div className="parliament-title">
            <Scale size={20} className="parliament-title-icon" />
            <span>Parliament Mode</span>
            <span className="parliament-badge">Multi-Agent Debate</span>
          </div>
          <div className="parliament-header-actions">
            {phase === 'running' && (
              <div className="parliament-timer">
                <Loader2 size={14} className="spin" />
                <span>{elapsedTime}s • {doneCount}/{totalRoles} agentes</span>
              </div>
            )}
            {phase === 'done' && (
              <>
                <button className="parl-btn parl-btn-ghost" onClick={exportToChat} title="Exportar para o chat">
                  <Download size={14} /> Exportar ao Chat
                </button>
                <button className="parl-btn parl-btn-ghost" onClick={reset} title="Novo debate">
                  <RefreshCw size={14} /> Novo Debate
                </button>
              </>
            )}
            <button className="parliament-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className="parliament-body">

          {/* ── Left: Problem + Config ── */}
          <div className="parliament-left">
            <div className="parliament-section">
              <label className="parliament-label">Problema ou Questão</label>
              <textarea
                className="parliament-problem-input"
                placeholder="Descreva o problema, decisão técnica, ou questão que os agentes devem debater..."
                value={problem}
                onChange={e => setProblem(e.target.value)}
                disabled={phase === 'running'}
                rows={5}
              />
            </div>

            <div className="parliament-section">
              <label className="parliament-label">
                <Users size={14} /> Papéis & Providers
              </label>
              <div className="parliament-roles-config">
                {roles.map(role => (
                  <div key={role.id} className="parliament-role-row" style={{ '--role-color': role.color } as any}>
                    <div className="parliament-role-info">
                      <span className="parliament-role-emoji">{role.emoji}</span>
                      <span className="parliament-role-name">{role.name}</span>
                    </div>
                    <div className="parliament-role-selectors">
                      <select
                        className="parl-select"
                        value={role.provider}
                        onChange={e => updateRoleProvider(role.id, e.target.value as Provider)}
                        disabled={phase === 'running'}
                      >
                        {PROVIDERS.map(p => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                      <input
                        className="parl-model-input"
                        value={role.model}
                        onChange={e => setRoles(prev => prev.map(r => r.id === role.id ? { ...r, model: e.target.value } : r))}
                        disabled={phase === 'running'}
                        placeholder="modelo"
                        title="Modelo"
                      />
                    </div>
                  </div>
                ))}

                {/* Coordinator row */}
                <div className="parliament-role-row parliament-coordinator-row" style={{ '--role-color': coordinator.color } as any}>
                  <div className="parliament-role-info">
                    <span className="parliament-role-emoji">{coordinator.emoji}</span>
                    <span className="parliament-role-name">Coordenador</span>
                    <span className="parl-coord-badge">síntese</span>
                  </div>
                  <div className="parliament-role-selectors">
                    <select
                      className="parl-select"
                      value={coordinator.provider}
                      onChange={e => updateCoordinatorProvider(e.target.value as Provider)}
                      disabled={phase === 'running'}
                    >
                      {PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <input
                      className="parl-model-input"
                      value={coordinator.model}
                      onChange={e => setCoordinator(prev => ({ ...prev, model: e.target.value }))}
                      disabled={phase === 'running'}
                      placeholder="modelo"
                      title="Modelo do Coordenador"
                    />
                  </div>
                </div>
              </div>
            </div>

            {phase === 'config' && (
              <button
                className={`parl-btn parl-btn-primary parl-start-btn ${!problem.trim() ? 'disabled' : ''}`}
                onClick={startDebate}
                disabled={!problem.trim()}
              >
                <Play size={16} fill="currentColor" />
                Iniciar Debate
              </button>
            )}

            {phase === 'running' && (
              <div className="parliament-progress-bar-wrap">
                <div className="parliament-progress-bar" style={{ width: `${(doneCount / totalRoles) * 100}%` }} />
                <span className="parliament-progress-label">
                  {coordinatorRunning && doneCount === totalRoles
                    ? '🎯 Coordenador sintetizando...'
                    : `${doneCount}/${totalRoles} especialistas concluídos`}
                </span>
              </div>
            )}

            {phase === 'done' && (
              <div className="parliament-done-badge">
                <CheckCircle2 size={16} />
                Debate concluído em {elapsedTime}s
              </div>
            )}
          </div>

          {/* ── Right: Results ── */}
          <div className="parliament-right">
            {phase === 'config' ? (
              <div className="parliament-empty-state">
                <Scale size={48} className="parliament-empty-icon" />
                <h3>Multi-Agent Debate</h3>
                <p>Configure os agentes e insira o problema. Cada especialista analisa pelo seu prisma exclusivo. O Coordenador sintetiza tudo no final.</p>
                <div className="parliament-roles-preview">
                  {DEFAULT_ROLES.map(r => (
                    <div key={r.id} className="parliament-preview-chip" style={{ borderColor: r.color }}>
                      <span>{r.emoji}</span>
                      <span>{r.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="parliament-tabs">
                  <button
                    className={`parliament-tab ${activeTab === 'roles' ? 'active' : ''}`}
                    onClick={() => setActiveTab('roles')}
                  >
                    <Users size={14} /> Especialistas
                    {phase === 'running' && <span className="parl-tab-badge">{doneCount}/{totalRoles}</span>}
                  </button>
                  <button
                    className={`parliament-tab ${activeTab === 'synthesis' ? 'active' : ''}`}
                    onClick={() => setActiveTab('synthesis')}
                    disabled={!coordinatorResult && phase !== 'done'}
                  >
                    <Scale size={14} /> Síntese
                    {coordinatorRunning && <Loader2 size={12} className="spin" />}
                    {coordinatorResult && <CheckCircle2 size={12} className="parl-tab-check" />}
                  </button>
                </div>

                {/* Role Results */}
                {activeTab === 'roles' && (
                  <div className="parliament-results">
                    {roles.map(role => {
                      const result = roleResults.get(role.id)
                      const isExpanded = expandedRoles.has(role.id)
                      return (
                        <div
                          key={role.id}
                          className={`parliament-result-card ${result?.status || 'idle'}`}
                          style={{ '--role-color': role.color } as any}
                        >
                          <div className="parliament-result-header" onClick={() => result?.status === 'done' && toggleExpanded(role.id)}>
                            <div className="parliament-result-title">
                              <span className="parliament-result-emoji">{role.emoji}</span>
                              <span className="parliament-result-name">{role.name}</span>
                              {result?.duration && <span className="parl-duration">{result.duration}s</span>}
                            </div>
                            <div className="parliament-result-status">
                              {!result || result.status === 'idle' ? null :
                               result.status === 'running' ? <Loader2 size={14} className="spin parl-spin-color" /> :
                               result.status === 'done' ? <CheckCircle2 size={14} className="parl-done-icon" /> :
                               <AlertCircle size={14} className="parl-error-icon" />}
                              {result?.status === 'done' && (
                                <>
                                  <button className="parl-copy-btn" onClick={e => { e.stopPropagation(); copyText(result.response, role.id) }}>
                                    {copiedId === role.id ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                                  </button>
                                  <ChevronDown size={14} className={`parl-chevron ${isExpanded ? 'expanded' : ''}`} />
                                </>
                              )}
                            </div>
                          </div>

                          {result?.status === 'running' && (
                            <div className="parl-typing">
                              <span /><span /><span />
                            </div>
                          )}

                          {result?.status === 'done' && isExpanded && (
                            <div
                              className="parliament-result-body"
                              dangerouslySetInnerHTML={{ __html: formatMd(result.response) }}
                            />
                          )}

                          {result?.status === 'error' && (
                            <div className="parliament-result-error">
                              <AlertCircle size={12} />
                              <span>{result.error || 'Erro desconhecido'}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Coordinator Synthesis */}
                {activeTab === 'synthesis' && (
                  <div className="parliament-synthesis">
                    {coordinatorRunning && !coordinatorResult ? (
                      <div className="parliament-coordinator-loading">
                        <Loader2 size={32} className="spin parl-coordinator-spin" />
                        <p>Coordenador analisando {totalRoles} perspectivas...</p>
                      </div>
                    ) : coordinatorResult ? (
                      <>
                        <div className="parliament-synthesis-header">
                          <div className="parliament-synthesis-title">
                            <span>🎯</span>
                            <span>Síntese do Coordenador</span>
                          </div>
                          <button className="parl-copy-btn" onClick={() => copyText(coordinatorResult, 'coordinator')}>
                            {copiedId === 'coordinator' ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                        <div
                          className="parliament-synthesis-body"
                          dangerouslySetInnerHTML={{ __html: formatMd(coordinatorResult) }}
                        />
                      </>
                    ) : (
                      <div className="parliament-synthesis-wait">
                        <Scale size={32} />
                        <p>A síntese aparecerá quando todos os especialistas concluírem.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
