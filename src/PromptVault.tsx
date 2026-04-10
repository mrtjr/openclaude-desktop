import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  Search,
  Plus,
  BookMarked,
  Tag,
  Edit3,
  Trash2,
  Upload,
  Download,
  ChevronRight,
  Hash,
  Zap,
  Copy,
  Check,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VaultPrompt {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  variables: string[]
  createdAt: number
  updatedAt: number
  useCount: number
}

interface PromptVaultProps {
  onClose: () => void
  onInsert: (text: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{([^}]+)\}\}/g) ?? []
  return [...new Set(matches.map((m) => m.slice(2, -2).trim()))]
}

function resolveVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (_, key) => values[key.trim()] ?? `{{${key.trim()}}}`)
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const CATEGORY_COLORS: Record<string, string> = {
  'Geral':      '#6366f1',
  'Código':     '#22c55e',
  'Escrita':    '#ec4899',
  'Análise':    '#f59e0b',
  'Marketing':  '#f97316',
  'Dev Ops':    '#06b6d4',
}

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? '#a855f7'
}

const BUILTIN_CATEGORY = 'Geral'

// ─── Sub-components ───────────────────────────────────────────────────────────

function HighlightedContent({ content }: { content: string }) {
  const parts = content.split(/(\{\{[^}]+\}\})/)
  return (
    <span>
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span key={i} style={{ color: '#f97316', background: 'rgba(249,115,22,0.12)', borderRadius: 3, padding: '0 2px', fontFamily: 'monospace', fontSize: '0.88em' }}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PromptVault: React.FC<PromptVaultProps> = ({ onClose, onInsert }) => {
  const [prompts, setPrompts] = useState<VaultPrompt[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingPrompt, setEditingPrompt] = useState<VaultPrompt | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [showVariableForm, setShowVariableForm] = useState<VaultPrompt | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Editor form state
  const [editorTitle, setEditorTitle] = useState('')
  const [editorContent, setEditorContent] = useState('')
  const [editorCategory, setEditorCategory] = useState(BUILTIN_CATEGORY)
  const [editorTags, setEditorTags] = useState('')

  const importRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    ;(async () => {
      try {
        const result = await window.electron.vaultLoad()
        setPrompts(result.prompts ?? [])
      } catch {
        setPrompts([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ── Save (debounced) ──────────────────────────────────────────────────────

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const savePrompts = useCallback(async (data: VaultPrompt[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await window.electron.vaultSave(data)
      } finally {
        setSaving(false)
      }
    }, 600)
  }, [])

  const updatePrompts = useCallback(
    (updater: (prev: VaultPrompt[]) => VaultPrompt[]) => {
      setPrompts((prev) => {
        const next = updater(prev)
        savePrompts(next)
        return next
      })
    },
    [savePrompts]
  )

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showVariableForm) { setShowVariableForm(null); return }
        if (showEditor) { closeEditor(); return }
        onClose()
      }
      if (e.key === 'Enter' && !showEditor && !showVariableForm && selectedPromptId) {
        const prompt = prompts.find((p) => p.id === selectedPromptId)
        if (prompt) handleUse(prompt)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showVariableForm, showEditor, selectedPromptId, prompts, onClose])

  // ── Derived state ─────────────────────────────────────────────────────────

  const categories = ['Todos', ...Array.from(new Set(prompts.map((p) => p.category))).sort()]

  const filteredPrompts = prompts.filter((p) => {
    const matchCat = selectedCategory === 'Todos' || p.category === selectedCategory
    const q = searchQuery.toLowerCase()
    const matchSearch =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.content.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)) ||
      p.category.toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  // ── CRUD ──────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditorTitle('')
    setEditorContent('')
    setEditorCategory(selectedCategory === 'Todos' ? BUILTIN_CATEGORY : selectedCategory)
    setEditorTags('')
    setEditingPrompt(null)
    setShowEditor(true)
  }

  function openEdit(p: VaultPrompt) {
    setEditorTitle(p.title)
    setEditorContent(p.content)
    setEditorCategory(p.category)
    setEditorTags(p.tags.join(', '))
    setEditingPrompt(p)
    setShowEditor(true)
  }

  function closeEditor() {
    setShowEditor(false)
    setEditingPrompt(null)
  }

  function saveEditor() {
    if (!editorTitle.trim() || !editorContent.trim()) return
    const variables = extractVariables(editorContent)
    const tags = editorTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const now = Date.now()

    if (editingPrompt) {
      updatePrompts((prev) =>
        prev.map((p) =>
          p.id === editingPrompt.id
            ? { ...p, title: editorTitle.trim(), content: editorContent, category: editorCategory, tags, variables, updatedAt: now }
            : p
        )
      )
    } else {
      const newPrompt: VaultPrompt = {
        id: generateId(),
        title: editorTitle.trim(),
        content: editorContent,
        category: editorCategory || BUILTIN_CATEGORY,
        tags,
        variables,
        createdAt: now,
        updatedAt: now,
        useCount: 0,
      }
      updatePrompts((prev) => [newPrompt, ...prev])
    }
    closeEditor()
  }

  function deletePrompt(id: string) {
    if (!window.confirm('Excluir este prompt?')) return
    updatePrompts((prev) => prev.filter((p) => p.id !== id))
    if (selectedPromptId === id) setSelectedPromptId(null)
  }

  // ── Use / variable resolution ─────────────────────────────────────────────

  function handleUse(prompt: VaultPrompt) {
    if (prompt.variables.length > 0) {
      const initial: Record<string, string> = {}
      prompt.variables.forEach((v) => (initial[v] = ''))
      setVariableValues(initial)
      setShowVariableForm(prompt)
    } else {
      insertPrompt(prompt)
    }
  }

  function insertPrompt(prompt: VaultPrompt, values?: Record<string, string>) {
    const text = values ? resolveVariables(prompt.content, values) : prompt.content
    updatePrompts((prev) =>
      prev.map((p) =>
        p.id === prompt.id ? { ...p, useCount: p.useCount + 1, updatedAt: Date.now() } : p
      )
    )
    onInsert(text)
    onClose()
  }

  function submitVariableForm() {
    if (!showVariableForm) return
    insertPrompt(showVariableForm, variableValues)
    setShowVariableForm(null)
  }

  function handleCopy(prompt: VaultPrompt) {
    navigator.clipboard.writeText(prompt.content)
    setCopiedId(prompt.id)
    setTimeout(() => setCopiedId(null), 1800)
  }

  // ── Import / Export ───────────────────────────────────────────────────────

  function exportPrompts() {
    const blob = new Blob([JSON.stringify({ prompts }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `promptvault-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        const imported: VaultPrompt[] = parsed.prompts ?? []
        if (!Array.isArray(imported)) throw new Error('Invalid format')
        const now = Date.now()
        const withIds = imported.map((p) => ({
          ...p,
          id: p.id ?? generateId(),
          variables: p.variables ?? extractVariables(p.content ?? ''),
          createdAt: p.createdAt ?? now,
          updatedAt: p.updatedAt ?? now,
          useCount: p.useCount ?? 0,
          tags: p.tags ?? [],
          category: p.category ?? BUILTIN_CATEGORY,
        }))
        updatePrompts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id))
          const newOnes = withIds.filter((p) => !existingIds.has(p.id))
          return [...prev, ...newOnes]
        })
        alert(`${withIds.length} prompt(s) importados.`)
      } catch {
        alert('Erro ao importar: arquivo inválido.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="vault-overlay"
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
        padding: '16px',
      }}
    >
      {/* ── Main modal ── */}
      <div
        className="vault-modal"
        style={{
          width: '100%',
          maxWidth: 1100,
          height: '85vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 16,
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          gridTemplateRows: 'auto 1fr',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* ── Header ── */}
        <div
          className="vault-header"
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
            <div
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'linear-gradient(135deg, #f97316, #a855f7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <BookMarked size={16} color="#fff" />
            </div>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>Prompt Vault</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 4 }}>
            {prompts.length} prompt{prompts.length !== 1 ? 's' : ''}
            {saving && ' · salvando…'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={exportPrompts}
              title="Exportar JSON"
              style={iconBtnStyle}
            >
              <Download size={15} />
            </button>
            <button
              onClick={() => importRef.current?.click()}
              title="Importar JSON"
              style={iconBtnStyle}
            >
              <Upload size={15} />
            </button>
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
            <button onClick={onClose} style={{ ...iconBtnStyle, marginLeft: 4 }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div
          className="vault-sidebar"
          style={{
            borderRight: '1px solid var(--border-color)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-primary)',
          }}
        >
          {/* Search */}
          <div style={{ padding: '12px 12px 8px' }}>
            <div className="vault-search" style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar prompts…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  padding: '7px 10px 7px 28px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* New prompt button */}
          <div style={{ padding: '0 12px 12px' }}>
            <button
              onClick={openCreate}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'linear-gradient(135deg, #f97316, #a855f7)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              <Plus size={14} />
              Novo Prompt
            </button>
          </div>

          {/* Category list */}
          <div style={{ flex: 1, padding: '0 8px', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', padding: '0 4px 6px' }}>Categorias</div>
            {categories.map((cat) => {
              const count = cat === 'Todos' ? prompts.length : prompts.filter((p) => p.category === cat).length
              const active = selectedCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    width: '100%', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 8px',
                    borderRadius: 7,
                    border: 'none',
                    background: active ? 'rgba(249,115,22,0.12)' : 'transparent',
                    color: active ? '#f97316' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.83rem',
                    fontWeight: active ? 600 : 400,
                    transition: 'background 0.15s, color 0.15s',
                    marginBottom: 1,
                  }}
                >
                  {cat !== 'Todos' && (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: categoryColor(cat), flexShrink: 0 }} />
                  )}
                  <span style={{ flex: 1 }}>{cat}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: 10, padding: '1px 6px' }}>{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Content panel ── */}
        <div
          className="vault-content"
          style={{ overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {/* Toolbar row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {filteredPrompts.length} resultado{filteredPrompts.length !== 1 ? 's' : ''}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['grid', 'list'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  style={{
                    ...iconBtnStyle,
                    background: viewMode === m ? 'rgba(249,115,22,0.15)' : 'transparent',
                    color: viewMode === m ? '#f97316' : 'var(--text-secondary)',
                  }}
                  title={m === 'grid' ? 'Grade' : 'Lista'}
                >
                  {m === 'grid' ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="0" y="0" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="8" y="0" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="0" y="8" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="8" y="8" width="6" height="6" rx="1.5" fill="currentColor"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="0" y="1" width="14" height="2" rx="1" fill="currentColor"/><rect x="0" y="6" width="14" height="2" rx="1" fill="currentColor"/><rect x="0" y="11" width="14" height="2" rx="1" fill="currentColor"/></svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Loading state */}
          {loading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              Carregando…
            </div>
          )}

          {/* Empty state */}
          {!loading && filteredPrompts.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-secondary)', paddingTop: 60 }}>
              <BookMarked size={48} style={{ opacity: 0.2 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                {searchQuery ? 'Nenhum prompt encontrado' : 'Nenhum prompt ainda'}
              </p>
              {!searchQuery && (
                <button onClick={openCreate} style={gradientBtnStyle}>
                  <Plus size={14} /> Criar primeiro prompt
                </button>
              )}
            </div>
          )}

          {/* Prompt grid / list */}
          {!loading && filteredPrompts.length > 0 && (
            <div
              style={
                viewMode === 'grid'
                  ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }
                  : { display: 'flex', flexDirection: 'column', gap: 8 }
              }
            >
              {filteredPrompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  isSelected={selectedPromptId === prompt.id}
                  isCopied={copiedId === prompt.id}
                  viewMode={viewMode}
                  onSelect={() => setSelectedPromptId(prompt.id)}
                  onEdit={() => openEdit(prompt)}
                  onDelete={() => deletePrompt(prompt.id)}
                  onUse={() => handleUse(prompt)}
                  onCopy={() => handleCopy(prompt)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Editor Modal ── */}
      {showEditor && (
        <EditorModal
          title={editorTitle}
          content={editorContent}
          category={editorCategory}
          tags={editorTags}
          isEditing={editingPrompt !== null}
          onChangeTitle={setEditorTitle}
          onChangeContent={(v) => { setEditorContent(v) }}
          onChangeCategory={setEditorCategory}
          onChangeTags={setEditorTags}
          onSave={saveEditor}
          onClose={closeEditor}
          categories={categories.filter((c) => c !== 'Todos')}
        />
      )}

      {/* ── Variable Form Modal ── */}
      {showVariableForm && (
        <VariableFormModal
          prompt={showVariableForm}
          values={variableValues}
          onChange={(key, val) => setVariableValues((prev) => ({ ...prev, [key]: val }))}
          onSubmit={submitVariableForm}
          onClose={() => setShowVariableForm(null)}
        />
      )}
    </div>
  )
}

// ─── Prompt Card ──────────────────────────────────────────────────────────────

interface PromptCardProps {
  prompt: VaultPrompt
  isSelected: boolean
  isCopied: boolean
  viewMode: 'grid' | 'list'
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onUse: () => void
  onCopy: () => void
}

const PromptCard: React.FC<PromptCardProps> = ({
  prompt, isSelected, isCopied, viewMode, onSelect, onEdit, onDelete, onUse, onCopy,
}) => {
  const [hovered, setHovered] = useState(false)

  const cardStyle: React.CSSProperties = {
    background: isSelected ? 'rgba(249,115,22,0.06)' : hovered ? 'rgba(255,255,255,0.03)' : 'var(--bg-primary)',
    border: `1px solid ${isSelected ? 'rgba(249,115,22,0.4)' : 'var(--border-color)'}`,
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
    boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.25)' : 'none',
    display: 'flex',
    flexDirection: viewMode === 'list' ? 'row' : 'column',
    alignItems: viewMode === 'list' ? 'center' : 'stretch',
    gap: viewMode === 'list' ? 12 : 0,
    overflow: 'hidden',
  }

  return (
    <div
      className="vault-card"
      style={cardStyle}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Category color bar */}
      <div style={{ height: viewMode === 'list' ? '100%' : 3, width: viewMode === 'list' ? 3 : '100%', minHeight: viewMode === 'list' ? 60 : undefined, background: categoryColor(prompt.category), flexShrink: 0 }} />

      <div style={{ padding: viewMode === 'list' ? '10px 12px 10px 0' : '12px', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>{prompt.title}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <span style={{ color: categoryColor(prompt.category) }}>{prompt.category}</span>
              {prompt.useCount > 0 && <span style={{ marginLeft: 6 }}>· {prompt.useCount}× usado</span>}
              {prompt.variables.length > 0 && (
                <span style={{ marginLeft: 6, color: '#f97316' }}>· {prompt.variables.length} var</span>
              )}
            </span>
          </div>
          {/* Actions */}
          <div style={{ display: 'flex', gap: 2, flexShrink: 0, opacity: hovered || isSelected ? 1 : 0, transition: 'opacity 0.15s' }}>
            <button onClick={(e) => { e.stopPropagation(); onCopy() }} style={miniBtn} title="Copiar">
              {isCopied ? <Check size={12} color="#22c55e" /> : <Copy size={12} />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onEdit() }} style={miniBtn} title="Editar">
              <Edit3 size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{ ...miniBtn, color: '#ef4444' }} title="Excluir">
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {viewMode === 'grid' && (
          <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {prompt.content.slice(0, 80)}{prompt.content.length > 80 ? '…' : ''}
          </p>
        )}

        {/* Tags */}
        {prompt.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {prompt.tags.slice(0, 4).map((tag) => (
              <span key={tag} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.68rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 5px', color: 'var(--text-secondary)' }}>
                <Hash size={9} />{tag}
              </span>
            ))}
          </div>
        )}

        {/* Use button */}
        <button
          onClick={(e) => { e.stopPropagation(); onUse() }}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'linear-gradient(135deg, #f97316, #a855f7)',
            color: '#fff', border: 'none', borderRadius: 6,
            padding: '5px 10px', cursor: 'pointer',
            fontSize: '0.75rem', fontWeight: 600,
            opacity: hovered || isSelected ? 1 : 0.7,
            transition: 'opacity 0.15s',
          }}
        >
          <Zap size={11} />
          Usar
          {prompt.variables.length > 0 && <span style={{ opacity: 0.85 }}>({prompt.variables.length} var)</span>}
        </button>
      </div>
    </div>
  )
}

// ─── Editor Modal ─────────────────────────────────────────────────────────────

interface EditorModalProps {
  title: string
  content: string
  category: string
  tags: string
  isEditing: boolean
  onChangeTitle: (v: string) => void
  onChangeContent: (v: string) => void
  onChangeCategory: (v: string) => void
  onChangeTags: (v: string) => void
  onSave: () => void
  onClose: () => void
  categories: string[]
}

const SUGGESTED_CATEGORIES = ['Geral', 'Código', 'Escrita', 'Análise', 'Marketing', 'Dev Ops']

const EditorModal: React.FC<EditorModalProps> = ({
  title, content, category, tags, isEditing,
  onChangeTitle, onChangeContent, onChangeCategory, onChangeTags,
  onSave, onClose, categories,
}) => {
  const detectedVars = extractVariables(content)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.currentTarget === e.target) onClose() }}
    >
      <div
        className="vault-form"
        style={{ width: '100%', maxWidth: 640, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-primary)' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            {isEditing ? 'Editar Prompt' : 'Novo Prompt'}
          </span>
          <button onClick={onClose} style={iconBtnStyle}><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Title */}
          <label style={labelStyle}>
            Título
            <input
              type="text"
              value={title}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder="Nome descritivo do prompt"
              style={inputStyle}
              autoFocus
            />
          </label>

          {/* Content */}
          <label style={labelStyle}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              Conteúdo
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                Use <code style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316', padding: '0 3px', borderRadius: 3 }}>{'{{variavel}}'}</code> para variáveis dinâmicas
              </span>
            </span>
            <textarea
              value={content}
              onChange={(e) => onChangeContent(e.target.value)}
              placeholder="Digite o prompt aqui…"
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.6 }}
            />
          </label>

          {/* Detected variables */}
          {detectedVars.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px', background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 8 }}>
              <span style={{ fontSize: '0.75rem', color: '#f97316', fontWeight: 600, width: '100%' }}>Variáveis detectadas:</span>
              {detectedVars.map((v) => (
                <span key={v} style={{ fontSize: '0.75rem', background: 'rgba(249,115,22,0.15)', color: '#f97316', borderRadius: 4, padding: '2px 7px', fontFamily: 'monospace' }}>
                  {'{{'}{v}{'}}'}
                </span>
              ))}
            </div>
          )}

          {/* Category */}
          <label style={labelStyle}>
            Categoria
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {[...new Set([...SUGGESTED_CATEGORIES, ...categories])].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => onChangeCategory(cat)}
                  style={{
                    fontSize: '0.78rem',
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: `1px solid ${category === cat ? categoryColor(cat) : 'var(--border-color)'}`,
                    background: category === cat ? `${categoryColor(cat)}22` : 'transparent',
                    color: category === cat ? categoryColor(cat) : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {cat}
                </button>
              ))}
              <input
                type="text"
                value={!SUGGESTED_CATEGORIES.includes(category) && !categories.includes(category) ? category : ''}
                onChange={(e) => onChangeCategory(e.target.value)}
                placeholder="Nova categoria…"
                style={{ ...inputStyle, width: 130, padding: '4px 8px', fontSize: '0.78rem' }}
              />
            </div>
          </label>

          {/* Tags */}
          <label style={labelStyle}>
            Tags <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>(separadas por vírgula)</span>
            <div style={{ position: 'relative' }}>
              <Tag size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input
                type="text"
                value={tags}
                onChange={(e) => onChangeTags(e.target.value)}
                placeholder="ex: copywriting, produto, seo"
                style={{ ...inputStyle, paddingLeft: 28 }}
              />
            </div>
          </label>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg-primary)' }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancelar</button>
          <button
            onClick={onSave}
            disabled={!title.trim() || !content.trim()}
            style={{ ...gradientBtnStyle, opacity: title.trim() && content.trim() ? 1 : 0.45 }}
          >
            {isEditing ? 'Salvar alterações' : 'Criar prompt'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Variable Form Modal ──────────────────────────────────────────────────────

interface VariableFormModalProps {
  prompt: VaultPrompt
  values: Record<string, string>
  onChange: (key: string, val: string) => void
  onSubmit: () => void
  onClose: () => void
}

const VariableFormModal: React.FC<VariableFormModalProps> = ({ prompt, values, onChange, onSubmit, onClose }) => {
  const allFilled = prompt.variables.every((v) => values[v]?.trim())

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.currentTarget === e.target) onClose() }}
    >
      <div style={{ width: '100%', maxWidth: 480, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', display: 'block' }}>Preencher variáveis</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{prompt.title}</span>
          </div>
          <button onClick={onClose} style={iconBtnStyle}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {prompt.variables.map((v) => (
            <label key={v} style={labelStyle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'monospace', color: '#f97316', fontSize: '0.88em' }}>{'{{'}{v}{'}}'}</span>
              </span>
              <input
                type="text"
                value={values[v] ?? ''}
                onChange={(e) => onChange(v, e.target.value)}
                placeholder={`Valor para "${v}"`}
                style={inputStyle}
                autoFocus={prompt.variables[0] === v}
                onKeyDown={(e) => { if (e.key === 'Enter' && allFilled) onSubmit() }}
              />
            </label>
          ))}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg-primary)' }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancelar</button>
          <button onClick={onSubmit} disabled={!allFilled} style={{ ...gradientBtnStyle, opacity: allFilled ? 1 : 0.45 }}>
            <Zap size={13} /> Inserir prompt
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared mini-styles (objects, not CSS) ────────────────────────────────────

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

const miniBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '3px 4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const gradientBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'linear-gradient(135deg, #f97316, #a855f7)',
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
  boxSizing: 'border-box',
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
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export default PromptVault
export type { VaultPrompt }
