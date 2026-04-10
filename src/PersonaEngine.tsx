import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  Plus,
  Edit3,
  Trash2,
  Check,
  ChevronRight,
  Zap,
  ZapOff,
  User,
  Shield,
  BarChart2,
  Layers,
  Feather,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Provider = 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal'

interface Persona {
  id: string
  name: string
  emoji: string
  description: string
  systemPrompt: string
  provider: Provider
  model: string
  ragEnabled: boolean
  color: string
  createdAt: number
  isBuiltIn: boolean
}

interface AppSettings {
  provider: Provider
  openaiApiKey: string
  openaiModel: string
  geminiApiKey: string
  geminiModel: string
  anthropicApiKey: string
  anthropicModel: string
  openrouterApiKey: string
  openrouterModel: string
  modalApiKey: string
  modalModel: string
  modalHostname: string
  language: 'pt' | 'en'
}

interface PersonaEngineProps {
  settings: AppSettings
  ollamaModels: string[]
  activePersonaId: string | null
  onClose: () => void
  onActivatePersona: (persona: Persona | null) => void
}

// ─── Built-in personas ────────────────────────────────────────────────────────

const BUILTIN_PERSONAS: Persona[] = [
  {
    id: 'builtin-sentinela',
    name: 'Sentinela',
    emoji: '🛡️',
    description: 'Especialista em segurança cibernética com foco em vulnerabilidades, OWASP e red team.',
    systemPrompt: `Você é Sentinela, um especialista sênior em segurança cibernética com mais de 15 anos de experiência em penetration testing, threat modeling e arquitetura de segurança.

Sua metodologia:
- Aplique o framework OWASP Top 10 em todas as análises
- Pense como um atacante (red team mindset) enquanto defende como um arquiteto
- Classifique vulnerabilidades por severidade: Crítica, Alta, Média, Baixa
- Forneça sempre PoC (Proof of Concept) quando relevante
- Sugira remediações concretas com código quando possível

Você analisa código, arquiteturas e configurações em busca de vetores de ataque. Seja direto, técnico e preciso.`,
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    ragEnabled: false,
    color: '#ef4444',
    createdAt: 0,
    isBuiltIn: true,
  },
  {
    id: 'builtin-quant',
    name: 'Quant',
    emoji: '📊',
    description: 'Analista quantitativo especializado em modelagem financeira, estatística e análise de mercados.',
    systemPrompt: `Você é Quant, um analista quantitativo de alto nível com formação em matemática aplicada, estatística e finanças computacionais.

Sua abordagem:
- Modele problemas financeiros com rigor matemático
- Use Python/pandas/numpy/scipy quando exemplificar código
- Cite métricas relevantes: Sharpe ratio, VaR, drawdown, alpha, beta
- Aplique estatística descritiva e inferencial com precisão
- Identifique vieses cognitivos e falácias em raciocínios financeiros
- Trabalhe com séries temporais, correlações e distribuições de probabilidade

Seja analítico, baseado em dados e evite especulações sem embasamento quantitativo.`,
    provider: 'openai',
    model: 'gpt-4o',
    ragEnabled: false,
    color: '#22c55e',
    createdAt: 0,
    isBuiltIn: true,
  },
  {
    id: 'builtin-arquiteto',
    name: 'Arquiteto',
    emoji: '🏛️',
    description: 'Arquiteto de software sênior com foco em design patterns, system design e code review.',
    systemPrompt: `Você é Arquiteto, um engenheiro de software sênior com expertise em design de sistemas distribuídos, padrões de arquitetura e qualidade de código.

Sua especialidade:
- Design patterns (GoF, SOLID, DRY, KISS, YAGNI)
- Arquiteturas: microservices, event-driven, CQRS, DDD, hexagonal
- Trade-offs de tecnologia com análise objetiva de prós e contras
- Code review focado em manutenibilidade, performance e segurança
- Diagramas e documentação de arquitetura (C4 model)
- Escalabilidade horizontal e vertical, fault tolerance e resiliência

Ao revisar código, aponte melhorias concretas com exemplos. Explique o "porquê" de cada decisão arquitetural.`,
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    ragEnabled: false,
    color: '#6366f1',
    createdAt: 0,
    isBuiltIn: true,
  },
  {
    id: 'builtin-poeta',
    name: 'Poeta',
    emoji: '✍️',
    description: 'Escritor criativo especializado em storytelling, copywriting e criação de conteúdo.',
    systemPrompt: `Você é Poeta, um escritor criativo versátil com domínio de narrativa, copywriting persuasivo e criação de conteúdo de alto impacto.

Seu repertório:
- Storytelling com estrutura (hero's journey, three-act, pixar story spine)
- Copywriting com frameworks: AIDA, PAS, FAB, 4Us
- Tom adaptável: formal, conversacional, urgente, inspirador, humorístico
- SEO-friendly sem sacrificar a qualidade literária
- Criação de personas, brand voice e guidelines editoriais
- Roteiros, scripts, posts, newsletters, landing pages

Produza conteúdo com originalidade, clareza e intenção. Cada palavra deve ter propósito.`,
    provider: 'openai',
    model: 'gpt-4o',
    ragEnabled: false,
    color: '#ec4899',
    createdAt: 0,
    isBuiltIn: true,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `persona-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const PRESET_COLORS = ['#ef4444', '#f97316', '#22c55e', '#6366f1', '#ec4899', '#06b6d4']
const EMOJI_OPTIONS = [
  '🤖','🧠','🛡️','📊','🏛️','✍️','🔬','🚀','⚡','🎯','🌐','💡',
  '🔧','📐','🎨','🧪','📚','🔍','💻','🌍','🦊','🐉','🎭','🏆',
  '⚔️','🧬','🌌','🎲','🔮','📡','🦾','🤝','🌊','🏔️','🎵','✨',
]

const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: 'Ollama (local)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  modal: 'Modal',
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PersonaEngine: React.FC<PersonaEngineProps> = ({
  settings,
  ollamaModels,
  activePersonaId,
  onClose,
  onActivatePersona,
}) => {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selected, setSelected] = useState<Persona | null>(null)
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const overlayRef = useRef<HTMLDivElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    ;(async () => {
      try {
        const result = await window.electron.personaLoad()
        let loaded: Persona[] = result.personas ?? []
        // Ensure built-ins are always present (merge by id)
        const loadedIds = new Set(loaded.map((p) => p.id))
        const missingBuiltIns = BUILTIN_PERSONAS.filter((p) => !loadedIds.has(p.id))
        loaded = [...missingBuiltIns, ...loaded]
        setPersonas(loaded)
        // Auto-select active or first
        const active = loaded.find((p) => p.id === activePersonaId)
        setSelected(active ?? loaded[0] ?? null)
      } catch {
        setPersonas(BUILTIN_PERSONAS)
        setSelected(BUILTIN_PERSONAS[0])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────

  const savePersonas = useCallback(async (data: Persona[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await window.electron.personaSave(data)
      } finally {
        setSaving(false)
      }
    }, 600)
  }, [])

  const updatePersonas = useCallback(
    (updater: (prev: Persona[]) => Persona[]) => {
      setPersonas((prev) => {
        const next = updater(prev)
        savePersonas(next)
        return next
      })
    },
    [savePersonas]
  )

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        setShowQuickSwitcher((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        if (showQuickSwitcher) { setShowQuickSwitcher(false); return }
        if (showEditor) { closeEditor(); return }
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showQuickSwitcher, showEditor, onClose])

  // ── CRUD ──────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingPersona({
      id: generateId(),
      name: '',
      emoji: '🤖',
      description: '',
      systemPrompt: '',
      provider: settings.provider,
      model: defaultModelForProvider(settings.provider, settings, ollamaModels),
      ragEnabled: false,
      color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
      createdAt: Date.now(),
      isBuiltIn: false,
    })
    setShowEditor(true)
  }

  function openEdit(persona: Persona) {
    setEditingPersona({ ...persona })
    setShowEditor(true)
  }

  function closeEditor() {
    setShowEditor(false)
    setEditingPersona(null)
  }

  function saveEditor(persona: Persona) {
    const isNew = !personas.find((p) => p.id === persona.id)
    if (isNew) {
      updatePersonas((prev) => [persona, ...prev])
      setSelected(persona)
    } else {
      updatePersonas((prev) => prev.map((p) => (p.id === persona.id ? persona : p)))
      setSelected(persona)
    }
    closeEditor()
  }

  function deletePersona(persona: Persona) {
    if (persona.isBuiltIn) return
    if (!window.confirm(`Excluir persona "${persona.name}"?`)) return
    updatePersonas((prev) => prev.filter((p) => p.id !== persona.id))
    if (selected?.id === persona.id) setSelected(personas.find((p) => p.id !== persona.id) ?? null)
    if (activePersonaId === persona.id) onActivatePersona(null)
  }

  function handleActivate(persona: Persona) {
    onActivatePersona(persona)
    onClose()
  }

  function handleDeactivate() {
    onActivatePersona(null)
    onClose()
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="persona-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* ── Main modal ── */}
      <div
        className="persona-modal"
        style={{
          width: '100%',
          maxWidth: 1000,
          height: '85vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 16,
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          gridTemplateRows: 'auto 1fr',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* ── Header ── */}
        <div
          className="persona-header"
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={16} color="#fff" />
            </div>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>Persona Engine</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {personas.length} persona{personas.length !== 1 ? 's' : ''}
            {saving && ' · salvando…'}
          </span>
          {activePersonaId && (
            <span style={{ fontSize: '0.72rem', background: 'rgba(99,102,241,0.2)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
              {personas.find((p) => p.id === activePersonaId)?.emoji} {personas.find((p) => p.id === activePersonaId)?.name} ativo
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 5px', fontSize: '0.68rem' }}>Ctrl+P</kbd>
              troca rápida
            </span>
            <button onClick={onClose} style={iconBtnStyle}><X size={16} /></button>
          </div>
        </div>

        {/* ── Sidebar: persona list ── */}
        <div
          className="persona-sidebar"
          style={{ borderRight: '1px solid var(--border-color)', overflowY: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}
        >
          <div style={{ padding: '12px 12px 4px' }}>
            <button onClick={openCreate} style={{ ...gradientBtnStyle, width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #6366f1, #ec4899)' }}>
              <Plus size={14} /> Nova Persona
            </button>
          </div>

          {loading && (
            <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: '0.82rem', textAlign: 'center' }}>Carregando…</div>
          )}

          <div style={{ padding: '8px', flex: 1, overflowY: 'auto' }}>
            {!loading && personas.map((persona) => {
              const isActive = persona.id === activePersonaId
              const isSelected = selected?.id === persona.id
              return (
                <PersonaSidebarItem
                  key={persona.id}
                  persona={persona}
                  isActive={isActive}
                  isSelected={isSelected}
                  onClick={() => setSelected(persona)}
                />
              )
            })}
          </div>
        </div>

        {/* ── Detail panel ── */}
        <div
          className="persona-detail"
          style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        >
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-secondary)', padding: 40 }}>
              <User size={48} style={{ opacity: 0.15 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>Selecione uma persona</p>
            </div>
          ) : (
            <PersonaDetail
              persona={selected}
              isActive={selected.id === activePersonaId}
              onActivate={() => handleActivate(selected)}
              onDeactivate={handleDeactivate}
              onEdit={() => openEdit(selected)}
              onDelete={() => deletePersona(selected)}
            />
          )}
        </div>
      </div>

      {/* ── Editor Modal ── */}
      {showEditor && editingPersona && (
        <PersonaEditorModal
          persona={editingPersona}
          settings={settings}
          ollamaModels={ollamaModels}
          onSave={saveEditor}
          onClose={closeEditor}
        />
      )}

      {/* ── Quick Switcher (Ctrl+P) ── */}
      {showQuickSwitcher && (
        <QuickSwitcher
          personas={personas}
          activePersonaId={activePersonaId}
          onSelect={(persona) => {
            if (persona) {
              onActivatePersona(persona)
            } else {
              onActivatePersona(null)
            }
            setShowQuickSwitcher(false)
            onClose()
          }}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}
    </div>
  )
}

// ─── Sidebar item ─────────────────────────────────────────────────────────────

const PersonaSidebarItem: React.FC<{
  persona: Persona
  isActive: boolean
  isSelected: boolean
  onClick: () => void
}> = ({ persona, isActive, isSelected, onClick }) => {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      className="persona-list-item"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: isSelected ? 'rgba(255,255,255,0.05)' : hovered ? 'rgba(255,255,255,0.025)' : 'transparent',
        border: 'none',
        borderLeft: `3px solid ${isSelected || isActive ? persona.color : 'transparent'}`,
        borderRadius: '0 8px 8px 0',
        cursor: 'pointer',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        transition: 'all 0.15s',
        marginBottom: 2,
        animation: isActive ? `personaGlow 2s ease-in-out infinite` : 'none',
      }}
    >
      <span style={{ fontSize: '1.4rem', lineHeight: 1, flexShrink: 0 }}>{persona.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{persona.name}</span>
          {isActive && (
            <span style={{ fontSize: '0.62rem', background: `${persona.color}22`, color: persona.color, border: `1px solid ${persona.color}44`, borderRadius: 4, padding: '0 4px', fontWeight: 700, flexShrink: 0 }}>Ativo</span>
          )}
          {persona.isBuiltIn && (
            <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', opacity: 0.6, flexShrink: 0 }}>built-in</span>
          )}
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{persona.description}</span>
      </div>
      {isSelected && <ChevronRight size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />}
    </button>
  )
}

// ─── Persona detail ───────────────────────────────────────────────────────────

const PersonaDetail: React.FC<{
  persona: Persona
  isActive: boolean
  onActivate: () => void
  onDeactivate: () => void
  onEdit: () => void
  onDelete: () => void
}> = ({ persona, isActive, onActivate, onDeactivate, onEdit, onDelete }) => {
  return (
    <div className="persona-detail-inner" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Persona hero */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 16,
          background: `${persona.color}18`,
          border: `2px solid ${persona.color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem',
          flexShrink: 0,
          boxShadow: isActive ? `0 0 20px ${persona.color}44` : 'none',
          transition: 'box-shadow 0.3s',
        }}>
          {persona.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>{persona.name}</h2>
            {isActive && (
              <span style={{ fontSize: '0.72rem', background: `${persona.color}22`, color: persona.color, border: `1px solid ${persona.color}55`, borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>● Ativo</span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{persona.description}</p>
        </div>
      </div>

      {/* Provider/model info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={infoCardStyle}>
          <span style={infoLabelStyle}>Provedor</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>{PROVIDER_LABELS[persona.provider]}</span>
        </div>
        <div style={infoCardStyle}>
          <span style={infoLabelStyle}>Modelo</span>
          <span style={{ fontSize: '0.83rem', color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{persona.model || '—'}</span>
        </div>
        <div style={infoCardStyle}>
          <span style={infoLabelStyle}>RAG</span>
          <span style={{ fontSize: '0.85rem', color: persona.ragEnabled ? '#22c55e' : 'var(--text-secondary)', fontWeight: 500 }}>
            {persona.ragEnabled ? '✓ Ativado' : 'Desativado'}
          </span>
        </div>
        <div style={infoCardStyle}>
          <span style={infoLabelStyle}>Cor</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: persona.color, flexShrink: 0 }} />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{persona.color}</span>
          </div>
        </div>
      </div>

      {/* System prompt */}
      <div>
        <div style={infoLabelStyle}>System Prompt</div>
        <div style={{
          marginTop: 8,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          padding: '14px 16px',
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          maxHeight: 240,
          overflowY: 'auto',
          fontFamily: 'monospace',
        }}>
          {persona.systemPrompt || <em style={{ opacity: 0.5 }}>Nenhum system prompt definido</em>}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
        {isActive ? (
          <button onClick={onDeactivate} style={{ ...secondaryBtnStyle, display: 'flex', alignItems: 'center', gap: 6, color: '#f97316', borderColor: 'rgba(249,115,22,0.4)' }}>
            <ZapOff size={14} /> Desativar
          </button>
        ) : (
          <button onClick={onActivate} style={{ ...gradientBtnStyle, background: `linear-gradient(135deg, ${persona.color}, ${shiftColor(persona.color)})` }}>
            <Zap size={14} /> Ativar Persona
          </button>
        )}
        <button onClick={onEdit} style={{ ...secondaryBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Edit3 size={14} /> Editar
        </button>
        {!persona.isBuiltIn && (
          <button onClick={onDelete} style={{ ...secondaryBtnStyle, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <Trash2 size={14} /> Excluir
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Persona Editor Modal ─────────────────────────────────────────────────────

interface PersonaEditorModalProps {
  persona: Persona
  settings: AppSettings
  ollamaModels: string[]
  onSave: (persona: Persona) => void
  onClose: () => void
}

const PersonaEditorModal: React.FC<PersonaEditorModalProps> = ({ persona: initial, settings, ollamaModels, onSave, onClose }) => {
  const [form, setForm] = useState<Persona>({ ...initial })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const update = (field: keyof Persona, value: unknown) => setForm((prev) => ({ ...prev, [field]: value }))

  const isValid = form.name.trim() && form.systemPrompt.trim()

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.currentTarget === e.target) onClose() }}
    >
      <div
        className="persona-form"
        style={{ width: '100%', maxWidth: 660, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-primary)', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            {initial.name ? `Editar: ${initial.name}` : 'Nova Persona'}
          </span>
          <button onClick={onClose} style={iconBtnStyle}><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Emoji + name row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <div style={labelStyle}>Emoji</div>
              <button
                onClick={() => setShowEmojiPicker((v) => !v)}
                style={{
                  marginTop: 5,
                  width: 52, height: 52,
                  background: `${form.color}18`,
                  border: `2px solid ${form.color}44`,
                  borderRadius: 12,
                  fontSize: '1.6rem',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {form.emoji}
              </button>
              {showEmojiPicker && (
                <div style={{
                  position: 'absolute',
                  marginTop: 6,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  padding: 10,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: 4,
                  zIndex: 10,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
                  width: 220,
                }}>
                  {EMOJI_OPTIONS.map((em) => (
                    <button
                      key={em}
                      onClick={() => { update('emoji', em); setShowEmojiPicker(false) }}
                      style={{ background: form.emoji === em ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', borderRadius: 6, padding: '4px', cursor: 'pointer', fontSize: '1.2rem', textAlign: 'center' }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label style={{ ...labelStyle, flex: 1 }}>
              Nome
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Nome da persona"
                style={inputStyle}
                autoFocus
              />
            </label>
          </div>

          {/* Description */}
          <label style={labelStyle}>
            Descrição
            <input
              type="text"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Resumo breve da persona"
              style={inputStyle}
            />
          </label>

          {/* System prompt */}
          <label style={labelStyle}>
            System Prompt
            <textarea
              value={form.systemPrompt}
              onChange={(e) => update('systemPrompt', e.target.value)}
              placeholder="Instruções completas para a persona…"
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.6 }}
            />
          </label>

          {/* Provider */}
          <label style={labelStyle}>
            Provedor
            <select
              value={form.provider}
              onChange={(e) => {
                const prov = e.target.value as Provider
                update('provider', prov)
                update('model', defaultModelForProvider(prov, settings, ollamaModels))
              }}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>

          {/* Model */}
          <label style={labelStyle}>
            Modelo
            {form.provider === 'ollama' && ollamaModels.length > 0 ? (
              <select value={form.model} onChange={(e) => update('model', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={form.model}
                onChange={(e) => update('model', e.target.value)}
                placeholder={`ex: ${defaultModelForProvider(form.provider, settings, ollamaModels)}`}
                style={inputStyle}
              />
            )}
          </label>

          {/* Color picker */}
          <div>
            <div style={labelStyle}>Cor</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => update('color', c)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: c, border: `2px solid ${form.color === c ? '#fff' : 'transparent'}`, cursor: 'pointer', flexShrink: 0, transition: 'border-color 0.15s',
                    boxShadow: form.color === c ? `0 0 0 3px ${c}55` : 'none',
                  }}
                  title={c}
                />
              ))}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Custom:</span>
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => update('color', e.target.value)}
                  style={{ width: 32, height: 28, padding: 0, border: '1px solid var(--border-color)', borderRadius: 6, cursor: 'pointer', background: 'none' }}
                />
              </div>
            </div>
          </div>

          {/* RAG toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '12px 16px' }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>RAG (Retrieval-Augmented Generation)</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Permite que a persona consulte documentos da base de conhecimento</div>
            </div>
            <button
              onClick={() => update('ragEnabled', !form.ragEnabled)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: form.ragEnabled ? '#22c55e' : 'var(--text-secondary)' }}
            >
              {form.ragEnabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg-primary)', flexShrink: 0 }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancelar</button>
          <button
            onClick={() => isValid && onSave(form)}
            disabled={!isValid}
            style={{ ...gradientBtnStyle, background: 'linear-gradient(135deg, #6366f1, #ec4899)', opacity: isValid ? 1 : 0.45 }}
          >
            <Check size={14} /> {initial.name ? 'Salvar alterações' : 'Criar persona'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Quick Switcher (Ctrl+P) ──────────────────────────────────────────────────

const QuickSwitcher: React.FC<{
  personas: Persona[]
  activePersonaId: string | null
  onSelect: (persona: Persona | null) => void
  onClose: () => void
}> = ({ personas, activePersonaId, onSelect, onClose }) => {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = personas.filter(
    (p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '18vh' }}
      onClick={(e) => { if (e.currentTarget === e.target) onClose() }}
    >
      <div style={{ width: '100%', maxWidth: 500, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Zap size={15} style={{ color: '#6366f1', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Trocar persona…"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.95rem', flex: 1 }}
          />
          <kbd style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 5px' }}>ESC</kbd>
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {/* Deactivate option */}
          {activePersonaId && (
            <button
              onClick={() => onSelect(null)}
              style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-color)', padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: '0.85rem' }}
            >
              <ZapOff size={15} />
              Desativar persona (modo padrão)
            </button>
          )}
          {filtered.map((persona) => {
            const isActive = persona.id === activePersonaId
            return (
              <button
                key={persona.id}
                onClick={() => onSelect(persona)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                  border: 'none',
                  borderLeft: `3px solid ${isActive ? persona.color : 'transparent'}`,
                  padding: '11px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'rgba(255,255,255,0.04)' : 'transparent' }}
              >
                <span style={{ fontSize: '1.3rem' }}>{persona.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{persona.name}</span>
                    {isActive && <span style={{ fontSize: '0.65rem', color: persona.color, fontWeight: 700 }}>Ativo</span>}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{persona.description}</span>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: persona.color, flexShrink: 0 }} />
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '20px 16px', color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>
              Nenhuma persona encontrada
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function defaultModelForProvider(provider: Provider, settings: AppSettings, ollamaModels: string[]): string {
  switch (provider) {
    case 'ollama':      return ollamaModels[0] ?? 'llama3'
    case 'openai':     return settings.openaiModel || 'gpt-4o'
    case 'gemini':     return settings.geminiModel || 'gemini-1.5-pro'
    case 'anthropic':  return settings.anthropicModel || 'claude-3-5-sonnet-20241022'
    case 'openrouter': return settings.openrouterModel || 'meta-llama/llama-3.1-70b-instruct'
    case 'modal':      return settings.modalModel || 'llama-3.1-70b'
    default:           return ''
  }
}

/** Shift a hex color slightly for gradient pairing */
function shiftColor(hex: string): string {
  const map: Record<string, string> = {
    '#ef4444': '#f97316',
    '#f97316': '#eab308',
    '#22c55e': '#06b6d4',
    '#6366f1': '#a855f7',
    '#ec4899': '#f97316',
    '#06b6d4': '#6366f1',
  }
  return map[hex] ?? '#a855f7'
}

// ─── Shared style objects ─────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 7,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '5px 7px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s',
}

const gradientBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'linear-gradient(135deg, #6366f1, #ec4899)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  cursor: 'pointer',
  fontSize: '0.82rem',
  fontWeight: 600,
}

const secondaryBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '8px 14px',
  fontSize: '0.82rem',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box' as const,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  padding: '8px 12px',
  outline: 'none',
  marginTop: 5,
}

const labelStyle: React.CSSProperties = {
  display: 'flex' as const,
  flexDirection: 'column' as const,
  gap: 0,
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
}

const infoCardStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  overflow: 'hidden',
}

const infoLabelStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-secondary)',
  fontWeight: 600,
}

export default PersonaEngine
export type { Persona }
