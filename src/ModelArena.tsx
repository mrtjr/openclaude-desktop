import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Trophy, Plus, Trash2, ChevronDown, ChevronUp,
  Copy, Check, Loader2, Zap, Clock, Hash, ThumbsUp
} from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { AppSettings } from './Settings'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ArenaModel {
  id: string
  provider: 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal' | 'custom'
  model: string
  apiKey: string
  label: string
}

export interface ArenaResult {
  modelId: string
  response: string
  responseTimeMs: number
  tokenCount: number
  status: 'idle' | 'loading' | 'done' | 'error'
  error?: string
}

export interface ArenaScore {
  modelId: string
  provider: string
  model: string
  wins: number
  losses: number
  totalVotes: number
  avgResponseMs: number
}

interface ModelArenaProps {
  settings: AppSettings
  ollamaModels: string[]
  onClose: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  ollama: '#7c3aed',
  openai: '#10a37f',
  gemini: '#4285f4',
  anthropic: '#d97706',
  openrouter: '#e11d48',
  modal: '#6366f1',
}

const PROVIDER_LABELS: Record<string, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  modal: 'Modal',
}

function getApiKeyForProvider(settings: AppSettings, provider: string): string {
  switch (provider) {
    case 'openai': return settings.openaiApiKey
    case 'gemini': return settings.geminiApiKey
    case 'anthropic': return settings.anthropicApiKey
    case 'openrouter': return settings.openrouterApiKey
    case 'modal': return settings.modalApiKey
    default: return ''
  }
}

function getDefaultModelForProvider(settings: AppSettings, provider: string): string {
  switch (provider) {
    case 'openai': return settings.openaiModel
    case 'gemini': return settings.geminiModel
    case 'anthropic': return settings.anthropicModel
    case 'openrouter': return settings.openrouterModel
    case 'modal': return settings.modalModel
    default: return ''
  }
}

function renderMarkdown(text: string): string {
  try {
    const html = marked.parse(text, { async: false }) as string
    return DOMPurify.sanitize(html)
  } catch {
    return DOMPurify.sanitize(text)
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ── Leaderboard Modal ─────────────────────────────────────────────────────────

function LeaderboardModal({
  scores,
  onClose,
}: {
  scores: ArenaScore[]
  onClose: () => void
}) {
  const sorted = [...scores].sort((a, b) => {
    const wrA = a.totalVotes > 0 ? a.wins / a.totalVotes : 0
    const wrB = b.totalVotes > 0 ? b.wins / b.totalVotes : 0
    return wrB - wrA
  })

  return (
    <div className="arena-lb-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="arena-lb-modal">
        <div className="arena-lb-header">
          <div className="arena-lb-title">
            <Trophy size={18} />
            <span>Leaderboard</span>
          </div>
          <button className="arena-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        {sorted.length === 0 ? (
          <div className="arena-lb-empty">Nenhum dado ainda. Faça comparações e vote!</div>
        ) : (
          <table className="arena-lb-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Modelo</th>
                <th>Provider</th>
                <th>Vitórias</th>
                <th>Win Rate</th>
                <th>Votos</th>
                <th>Tempo Médio</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const wr = s.totalVotes > 0 ? ((s.wins / s.totalVotes) * 100).toFixed(1) : '—'
                return (
                  <tr key={s.modelId} className={i === 0 ? 'arena-lb-first' : ''}>
                    <td className="arena-lb-rank">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </td>
                    <td className="arena-lb-model">{s.model}</td>
                    <td>
                      <span
                        className="arena-provider-badge"
                        style={{ background: `${PROVIDER_COLORS[s.provider]}22`, color: PROVIDER_COLORS[s.provider] }}
                      >
                        {PROVIDER_LABELS[s.provider] || s.provider}
                      </span>
                    </td>
                    <td className="arena-lb-wins">{s.wins}</td>
                    <td className="arena-lb-wr">{wr}{typeof wr === 'string' && wr !== '—' ? '%' : ''}</td>
                    <td>{s.totalVotes}</td>
                    <td>{s.avgResponseMs > 0 ? `${Math.round(s.avgResponseMs)}ms` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Add Model Form ─────────────────────────────────────────────────────────────

function AddModelForm({
  settings,
  ollamaModels,
  onAdd,
  onCancel,
}: {
  settings: AppSettings
  ollamaModels: string[]
  onAdd: (m: ArenaModel) => void
  onCancel: () => void
}) {
  const [provider, setProvider] = useState<ArenaModel['provider']>('ollama')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState('')

  useEffect(() => {
    setModel(getDefaultModelForProvider(settings, provider))
    setApiKey(getApiKeyForProvider(settings, provider))
    setLabel('')
  }, [provider, settings])

  const handleAdd = () => {
    if (!model.trim()) return
    onAdd({
      id: generateId(),
      provider,
      model: model.trim(),
      apiKey: apiKey.trim(),
      label: label.trim() || `${PROVIDER_LABELS[provider]} / ${model.trim()}`,
    })
  }

  return (
    <div className="arena-add-form">
      <div className="arena-add-row">
        <label className="arena-add-label">Provider</label>
        <select
          className="arena-select"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ArenaModel['provider'])}
        >
          <option value="ollama">Ollama (Local)</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
          <option value="anthropic">Anthropic</option>
          <option value="openrouter">OpenRouter</option>
          <option value="modal">Modal</option>
        </select>
      </div>
      <div className="arena-add-row">
        <label className="arena-add-label">Modelo</label>
        {provider === 'ollama' ? (
          <select
            className="arena-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {ollamaModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            className="arena-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="nome-do-modelo"
          />
        )}
      </div>
      {provider !== 'ollama' && (
        <div className="arena-add-row">
          <label className="arena-add-label">API Key</label>
          <input
            className="arena-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sua-api-key"
          />
        </div>
      )}
      <div className="arena-add-row">
        <label className="arena-add-label">Label</label>
        <input
          className="arena-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`${PROVIDER_LABELS[provider]} / ${model || 'modelo'}`}
        />
      </div>
      <div className="arena-add-actions">
        <button className="arena-btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="arena-btn-primary" onClick={handleAdd} disabled={!model.trim()}>
          Adicionar
        </button>
      </div>
    </div>
  )
}

// ── Result Column ─────────────────────────────────────────────────────────────

function ResultColumn({
  arenaModel,
  result,
  canVote,
  hasVoted,
  onVote,
  onRemove,
}: {
  arenaModel: ArenaModel
  result: ArenaResult | undefined
  canVote: boolean
  hasVoted: boolean
  onVote: (modelId: string) => void
  onRemove: (modelId: string) => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (result?.response) {
      navigator.clipboard.writeText(result.response)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const status = result?.status ?? 'idle'
  const color = PROVIDER_COLORS[arenaModel.provider]

  return (
    <div className={`arena-column ${status === 'done' ? 'arena-column-done' : ''}`}>
      {/* Column header */}
      <div className="arena-col-header" style={{ borderTop: `2px solid ${color}` }}>
        <div className="arena-col-info">
          <div className="arena-col-label">{arenaModel.label}</div>
          <span
            className="arena-provider-badge"
            style={{ background: `${color}22`, color }}
          >
            {PROVIDER_LABELS[arenaModel.provider]}
          </span>
        </div>
        <div className="arena-col-actions">
          {result?.status === 'done' && (
            <button className="arena-icon-btn" onClick={handleCopy} title="Copiar resposta">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          <button className="arena-icon-btn arena-icon-btn-danger" onClick={() => onRemove(arenaModel.id)} title="Remover">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Metrics bar */}
      {result && (result.status === 'done' || result.status === 'error') && (
        <div className="arena-col-metrics">
          <span className="arena-metric">
            <Clock size={11} />
            {result.responseTimeMs}ms
          </span>
          <span className="arena-metric">
            <Hash size={11} />
            ~{result.tokenCount} tok
          </span>
          {result.status === 'done' && (
            <span className="arena-metric arena-metric-ok">
              <Zap size={11} />
              OK
            </span>
          )}
          {result.status === 'error' && (
            <span className="arena-metric arena-metric-err">Erro</span>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="arena-col-body">
        {status === 'idle' && (
          <div className="arena-col-placeholder">Aguardando comparação...</div>
        )}
        {status === 'loading' && (
          <div className="arena-col-loading">
            <Loader2 size={20} className="arena-spin" />
            <span>Gerando resposta...</span>
          </div>
        )}
        {status === 'error' && (
          <div className="arena-col-error">
            <span>Erro:</span>
            <pre>{result?.error}</pre>
          </div>
        )}
        {status === 'done' && result?.response && (
          <div
            className="arena-col-markdown"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(result.response) }}
          />
        )}
      </div>

      {/* Vote button */}
      {canVote && status === 'done' && (
        <div className="arena-col-footer">
          <button
            className={`arena-vote-btn ${hasVoted ? 'arena-vote-btn-winner' : ''}`}
            onClick={() => onVote(arenaModel.id)}
          >
            <ThumbsUp size={14} />
            {hasVoted ? 'Melhor Resposta ✓' : 'Melhor Resposta'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ModelArena({ settings, ollamaModels, onClose }: ModelArenaProps) {
  const [models, setModels] = useState<ArenaModel[]>([])
  const [results, setResults] = useState<Map<string, ArenaResult>>(new Map())
  const [message, setMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [votedModelId, setVotedModelId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [scores, setScores] = useState<ArenaScore[]>([])
  const [copied, setCopied] = useState(false)
  const runIdRef = useRef(0)

  // Initialize with default model from settings
  useEffect(() => {
    const defaultModel: ArenaModel = {
      id: generateId(),
      provider: settings.provider as ArenaModel['provider'],
      model: getDefaultModelForProvider(settings, settings.provider),
      apiKey: getApiKeyForProvider(settings, settings.provider),
      label: `${PROVIDER_LABELS[settings.provider]} / ${getDefaultModelForProvider(settings, settings.provider)}`,
    }
    setModels([defaultModel])

    // Load scores
    window.electron.arenaLoad().then(({ scores: loaded }) => {
      if (loaded) setScores(loaded)
    }).catch(() => {})
  }, [settings])

  const allDone = models.length > 0 && models.every((m) => {
    const r = results.get(m.id)
    return r && (r.status === 'done' || r.status === 'error')
  })

  const canVote = allDone && votedModelId === null

  const handleRun = useCallback(async () => {
    if (!message.trim() || isRunning || models.length === 0) return
    setIsRunning(true)
    setVotedModelId(null)
    runIdRef.current++
    const currentRunId = runIdRef.current

    // Reset results
    const initResults = new Map<string, ArenaResult>()
    for (const m of models) {
      initResults.set(m.id, {
        modelId: m.id,
        response: '',
        responseTimeMs: 0,
        tokenCount: 0,
        status: 'loading',
      })
    }
    setResults(new Map(initResults))

    // Run all in parallel
    const tasks = models.map(async (arenaModel) => {
      const start = Date.now()
      try {
        const res = await window.electron.providerChat({
          provider: arenaModel.provider,
          apiKey: arenaModel.apiKey,
          model: arenaModel.model,
          messages: [{ role: 'user', content: message }],
          temperature: 0.7,
          max_tokens: 2048,
          modalHostname: settings.modalHostname,
        })
        const elapsed = Date.now() - start
        const text: string =
          res?.choices?.[0]?.message?.content ??
          res?.content?.[0]?.text ??
          res?.candidates?.[0]?.content?.parts?.[0]?.text ??
          ''

        if (runIdRef.current !== currentRunId) return
        setResults((prev) => {
          const next = new Map(prev)
          next.set(arenaModel.id, {
            modelId: arenaModel.id,
            response: text,
            responseTimeMs: elapsed,
            tokenCount: Math.round(text.length / 4),
            status: 'done',
          })
          return next
        })
      } catch (err: any) {
        const elapsed = Date.now() - start
        if (runIdRef.current !== currentRunId) return
        setResults((prev) => {
          const next = new Map(prev)
          next.set(arenaModel.id, {
            modelId: arenaModel.id,
            response: '',
            responseTimeMs: elapsed,
            tokenCount: 0,
            status: 'error',
            error: err?.message ?? String(err),
          })
          return next
        })
      }
    })

    await Promise.allSettled(tasks)
    if (runIdRef.current === currentRunId) setIsRunning(false)
  }, [message, models, isRunning, settings.modalHostname])

  const handleVote = async (winnerModelId: string) => {
    if (votedModelId !== null) return
    setVotedModelId(winnerModelId)

    const updatedScores = [...scores]

    for (const m of models) {
      const result = results.get(m.id)
      if (!result || result.status !== 'done') continue

      const existing = updatedScores.find((s) => s.modelId === m.id)
      const isWinner = m.id === winnerModelId

      if (existing) {
        existing.wins += isWinner ? 1 : 0
        existing.losses += isWinner ? 0 : 1
        existing.totalVotes += 1
        // Running average
        existing.avgResponseMs =
          (existing.avgResponseMs * (existing.totalVotes - 1) + result.responseTimeMs) /
          existing.totalVotes
      } else {
        updatedScores.push({
          modelId: m.id,
          provider: m.provider,
          model: m.model,
          wins: isWinner ? 1 : 0,
          losses: isWinner ? 0 : 1,
          totalVotes: 1,
          avgResponseMs: result.responseTimeMs,
        })
      }
    }

    setScores(updatedScores)
    try {
      await window.electron.arenaSave(updatedScores)
    } catch {}
  }

  const handleRemoveModel = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id))
    setResults((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  const handleAddModel = (m: ArenaModel) => {
    setModels((prev) => [...prev, m])
    setShowAddForm(false)
  }

  const handleExport = () => {
    const parts: string[] = [`# Model Arena — Export\n\n**Prompt:** ${message}\n\n---\n`]
    for (const m of models) {
      const r = results.get(m.id)
      parts.push(`## ${m.label}\n`)
      parts.push(`**Provider:** ${m.provider} | **Tempo:** ${r?.responseTimeMs ?? 0}ms | **Tokens:** ~${r?.tokenCount ?? 0}\n`)
      parts.push(r?.response ?? '*Sem resposta*')
      parts.push('\n\n---\n')
    }
    navigator.clipboard.writeText(parts.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <style>{ARENA_CSS}</style>
      <div className="arena-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="arena-modal">
          {/* Header */}
          <div className="arena-header">
            <div className="arena-header-left">
              <div className="arena-title-group">
                <Zap size={18} className="arena-title-icon" />
                <span className="arena-title">Model Arena</span>
                <span className="arena-badge">Comparação de Modelos</span>
              </div>
            </div>
            <div className="arena-header-right">
              <button
                className="arena-btn-ghost"
                onClick={handleExport}
                title="Copiar todas as respostas"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>Export</span>
              </button>
              <button
                className="arena-btn-ghost"
                onClick={() => setShowLeaderboard(true)}
              >
                <Trophy size={14} />
                <span>Leaderboard</span>
              </button>
              <button className="arena-icon-btn" onClick={onClose}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Input area */}
          <div className="arena-input-area">
            <textarea
              className="arena-message-input"
              placeholder="Digite sua mensagem para comparar entre os modelos..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun()
              }}
              rows={3}
            />
            <div className="arena-input-actions">
              <span className="arena-input-hint">Ctrl+Enter para comparar</span>
              <button
                className="arena-btn-primary arena-run-btn"
                onClick={handleRun}
                disabled={isRunning || !message.trim() || models.length === 0}
              >
                {isRunning ? (
                  <>
                    <Loader2 size={14} className="arena-spin" />
                    Comparando...
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    Comparar
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Config panel */}
          <div className="arena-config-section">
            <button
              className="arena-config-toggle"
              onClick={() => setShowConfig((v) => !v)}
            >
              {showConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>Modelos na Arena ({models.length})</span>
            </button>
            {showConfig && (
              <div className="arena-config-panel">
                <div className="arena-models-list">
                  {models.map((m) => (
                    <div key={m.id} className="arena-model-chip">
                      <span
                        className="arena-chip-dot"
                        style={{ background: PROVIDER_COLORS[m.provider] }}
                      />
                      <span className="arena-chip-label">{m.label}</span>
                      <button
                        className="arena-chip-remove"
                        onClick={() => handleRemoveModel(m.id)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="arena-add-btn"
                    onClick={() => setShowAddForm((v) => !v)}
                  >
                    <Plus size={14} />
                    <span>Adicionar Modelo</span>
                  </button>
                </div>
                {showAddForm && (
                  <AddModelForm
                    settings={settings}
                    ollamaModels={ollamaModels}
                    onAdd={handleAddModel}
                    onCancel={() => setShowAddForm(false)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Columns area */}
          <div className="arena-columns-scroll">
            <div
              className="arena-columns"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, models.length)}, minmax(280px, 1fr))` }}
            >
              {models.map((m) => (
                <ResultColumn
                  key={m.id}
                  arenaModel={m}
                  result={results.get(m.id)}
                  canVote={canVote}
                  hasVoted={votedModelId === m.id}
                  onVote={handleVote}
                  onRemove={handleRemoveModel}
                />
              ))}
              {models.length === 0 && (
                <div className="arena-empty">
                  <Plus size={32} />
                  <p>Adicione modelos para começar a comparar</p>
                  <button
                    className="arena-btn-primary"
                    onClick={() => { setShowConfig(true); setShowAddForm(true) }}
                  >
                    Adicionar Modelo
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Vote status */}
          {votedModelId && (
            <div className="arena-voted-bar">
              <ThumbsUp size={14} />
              <span>
                Você votou em:{' '}
                <strong>{models.find((m) => m.id === votedModelId)?.label}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {showLeaderboard && (
        <LeaderboardModal scores={scores} onClose={() => setShowLeaderboard(false)} />
      )}
    </>
  )
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const ARENA_CSS = `
.arena-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.arena-modal {
  background: var(--bg-primary, #0d0d17);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 12px;
  width: 100%;
  max-width: 1400px;
  height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.arena-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  flex-shrink: 0;
}

.arena-header-left { display: flex; align-items: center; gap: 12px; }
.arena-header-right { display: flex; align-items: center; gap: 8px; }

.arena-title-group { display: flex; align-items: center; gap: 10px; }
.arena-title-icon { color: #a78bfa; }
.arena-title { font-size: 1rem; font-weight: 600; color: var(--text-primary, #f1f1f1); }
.arena-badge {
  background: rgba(167,139,250,0.12);
  color: #a78bfa;
  border: 1px solid rgba(167,139,250,0.25);
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 0.72rem;
  font-weight: 500;
}

.arena-input-area {
  padding: 12px 18px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  flex-shrink: 0;
}

.arena-message-input {
  width: 100%;
  background: var(--bg-secondary, #13131f);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 8px;
  color: var(--text-primary, #f1f1f1);
  font-size: 0.9rem;
  padding: 10px 12px;
  resize: none;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.arena-message-input:focus {
  border-color: rgba(167,139,250,0.4);
}
.arena-message-input::placeholder { color: var(--text-secondary, #888); }

.arena-input-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.arena-input-hint { font-size: 0.75rem; color: var(--text-secondary, #888); }

.arena-run-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  font-size: 0.875rem;
}

.arena-config-section {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
}

.arena-config-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  width: 100%;
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  font-size: 0.8rem;
  text-align: left;
  transition: color 0.15s;
}
.arena-config-toggle:hover { color: var(--text-primary, #f1f1f1); }

.arena-config-panel {
  padding: 0 18px 12px;
}

.arena-models-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.arena-model-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-secondary, #13131f);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 20px;
  padding: 4px 10px 4px 8px;
  font-size: 0.78rem;
  color: var(--text-primary, #f1f1f1);
}
.arena-chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.arena-chip-label { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arena-chip-remove {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0;
  transition: color 0.15s;
}
.arena-chip-remove:hover { color: #ef4444; }

.arena-add-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px dashed var(--border-color, rgba(255,255,255,0.08));
  border-radius: 20px;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 4px 10px;
  font-size: 0.78rem;
  transition: all 0.15s;
}
.arena-add-btn:hover {
  border-color: rgba(167,139,250,0.4);
  color: #a78bfa;
}

.arena-add-form {
  margin-top: 12px;
  background: var(--bg-secondary, #13131f);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.arena-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.arena-add-label {
  font-size: 0.78rem;
  color: var(--text-secondary, #888);
  min-width: 60px;
  flex-shrink: 0;
}
.arena-add-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.arena-columns-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0;
}

.arena-columns {
  display: grid;
  height: 100%;
  min-height: 0;
}

.arena-column {
  border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.arena-column:last-child { border-right: none; }

.arena-col-header {
  padding: 10px 14px 8px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
}
.arena-col-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.arena-col-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary, #f1f1f1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arena-col-actions { display: flex; gap: 4px; flex-shrink: 0; }

.arena-col-metrics {
  display: flex;
  gap: 10px;
  padding: 5px 14px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  flex-shrink: 0;
}
.arena-metric {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 0.72rem;
  color: var(--text-secondary, #888);
}
.arena-metric-ok { color: #22c55e; }
.arena-metric-err { color: #ef4444; }

.arena-col-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  min-height: 0;
}

.arena-col-placeholder {
  color: var(--text-secondary, #888);
  font-size: 0.82rem;
  text-align: center;
  padding: 40px 0;
}

.arena-col-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary, #888);
  font-size: 0.82rem;
  padding: 40px 0;
}

.arena-col-error {
  color: #ef4444;
  font-size: 0.82rem;
}
.arena-col-error pre {
  margin-top: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.75rem;
  opacity: 0.8;
}

.arena-col-markdown {
  font-size: 0.85rem;
  line-height: 1.65;
  color: var(--text-primary, #f1f1f1);
}
.arena-col-markdown h1,.arena-col-markdown h2,.arena-col-markdown h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 12px 0 6px;
}
.arena-col-markdown p { margin: 0 0 8px; }
.arena-col-markdown code {
  background: rgba(255,255,255,0.07);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.78rem;
  font-family: monospace;
}
.arena-col-markdown pre {
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.arena-col-markdown pre code { background: none; padding: 0; }
.arena-col-markdown ul,.arena-col-markdown ol { padding-left: 18px; margin: 0 0 8px; }
.arena-col-markdown li { margin-bottom: 3px; }

.arena-col-footer {
  padding: 8px 14px;
  border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));
  flex-shrink: 0;
}

.arena-vote-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(34,197,94,0.08);
  border: 1px solid rgba(34,197,94,0.25);
  color: #22c55e;
  border-radius: 6px;
  padding: 7px;
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s;
}
.arena-vote-btn:hover {
  background: rgba(34,197,94,0.18);
  border-color: rgba(34,197,94,0.5);
}
.arena-vote-btn-winner {
  background: rgba(34,197,94,0.2);
  border-color: #22c55e;
  font-weight: 600;
}

.arena-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary, #888);
  height: 100%;
  min-height: 200px;
  grid-column: 1 / -1;
}
.arena-empty p { font-size: 0.88rem; margin: 0; }

.arena-voted-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: rgba(34,197,94,0.07);
  border-top: 1px solid rgba(34,197,94,0.2);
  color: #22c55e;
  font-size: 0.82rem;
  flex-shrink: 0;
}

/* Shared form elements */
.arena-select, .arena-input {
  flex: 1;
  background: var(--bg-primary, #0d0d17);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 6px;
  color: var(--text-primary, #f1f1f1);
  font-size: 0.82rem;
  padding: 6px 10px;
  outline: none;
  font-family: inherit;
}
.arena-select:focus, .arena-input:focus {
  border-color: rgba(167,139,250,0.4);
}

/* Buttons */
.arena-btn-primary {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #7c3aed;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  padding: 6px 14px;
  font-size: 0.82rem;
  font-weight: 500;
  transition: background 0.15s;
}
.arena-btn-primary:hover:not(:disabled) { background: #6d28d9; }
.arena-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

.arena-btn-ghost {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 6px;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 5px 12px;
  font-size: 0.8rem;
  transition: all 0.15s;
}
.arena-btn-ghost:hover { color: var(--text-primary, #f1f1f1); border-color: rgba(255,255,255,0.2); }

.arena-icon-btn {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}
.arena-icon-btn:hover { color: var(--text-primary, #f1f1f1); background: rgba(255,255,255,0.06); }
.arena-icon-btn-danger:hover { color: #ef4444; }

.arena-provider-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.arena-spin {
  animation: arena-spin 0.8s linear infinite;
}
@keyframes arena-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Leaderboard */
.arena-lb-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 20px;
}
.arena-lb-modal {
  background: var(--bg-primary, #0d0d17);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 10px;
  width: 100%;
  max-width: 700px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.arena-lb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
}
.arena-lb-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary, #f1f1f1);
}
.arena-lb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.arena-lb-table th {
  text-align: left;
  padding: 8px 14px;
  color: var(--text-secondary, #888);
  font-weight: 500;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.arena-lb-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.05));
  color: var(--text-primary, #f1f1f1);
}
.arena-lb-table tbody tr:hover { background: rgba(255,255,255,0.02); }
.arena-lb-first td { background: rgba(167,139,250,0.04); }
.arena-lb-rank { font-size: 1rem; }
.arena-lb-model { font-weight: 500; }
.arena-lb-wins { color: #22c55e; font-weight: 600; }
.arena-lb-wr { color: #a78bfa; font-weight: 600; }
.arena-lb-empty {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 0.85rem;
}
`
