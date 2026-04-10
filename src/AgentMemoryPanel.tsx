/**
 * AgentMemoryPanel.tsx — v1.9.0
 * Visualiza e edita a memória persistente do agente.
 * Usado como aba 'Memória' em Settings.tsx.
 */
import React, { useEffect, useState, useCallback } from 'react'

interface MemoryEntry {
  key: string
  value: string
  updatedAt: number
}

interface EpisodicEntry {
  summary: string
  conversationId: string
  timestamp: number
}

interface AgentMemory {
  workingMemory: MemoryEntry[]
  episodic: EpisodicEntry[]
  pinned: { content: string; pinnedAt: number }[]
  version: number
}

const el = (window as any).electron

export default function AgentMemoryPanel({ lang = 'pt' }: { lang?: string }) {
  const [mem, setMem] = useState<AgentMemory | null>(null)
  const [loading, setLoading] = useState(true)
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')
  const [tab, setTab] = useState<'working' | 'episodic'>('working')
  const [saving, setSaving] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')

  const t = (pt: string, en: string) => lang === 'pt' ? pt : en

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await el.loadAgentMemory()
      setMem(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const save = async (updated: AgentMemory) => {
    setSaving(true)
    try { await el.saveAgentMemory(updated) }
    finally { setSaving(false) }
  }

  const deleteKey = async (key: string) => {
    if (!mem) return
    const updated = { ...mem, workingMemory: mem.workingMemory.filter(m => m.key !== key) }
    setMem(updated)
    await save(updated)
  }

  const upsertEntry = async () => {
    if (!newKey.trim() || !mem) return
    const existing = mem.workingMemory.findIndex(m => m.key === newKey.trim())
    const entry: MemoryEntry = { key: newKey.trim(), value: newVal, updatedAt: Date.now() }
    let updated: AgentMemory
    if (existing >= 0) {
      const wm = [...mem.workingMemory]
      wm[existing] = entry
      updated = { ...mem, workingMemory: wm }
    } else {
      updated = { ...mem, workingMemory: [...mem.workingMemory, entry] }
    }
    setMem(updated)
    await save(updated)
    setNewKey(''); setNewVal('')
  }

  const updateEntry = async (key: string, value: string) => {
    if (!mem) return
    const wm = mem.workingMemory.map(m => m.key === key ? { ...m, value, updatedAt: Date.now() } : m)
    const updated = { ...mem, workingMemory: wm }
    setMem(updated)
    await save(updated)
    setEditKey('')
  }

  const clearAll = async () => {
    if (!confirm(t('Apagar toda a memória do agente?', 'Clear all agent memory?'))) return
    const empty: AgentMemory = { workingMemory: [], episodic: [], pinned: [], version: 1 }
    setMem(empty)
    await save(empty)
  }

  if (loading) return <div className="memory-loading">{t('Carregando memória…', 'Loading memory…')}</div>
  if (!mem) return <div className="memory-error">{t('Erro ao carregar memória.', 'Failed to load memory.')}</div>

  return (
    <div className="agent-memory-panel">
      <div className="memory-header">
        <h3>🧠 {t('Memória do Agente', 'Agent Memory')}</h3>
        <div className="memory-tabs">
          <button className={tab === 'working' ? 'active' : ''} onClick={() => setTab('working')}>
            {t('Memória Ativa', 'Working Memory')} ({mem.workingMemory.length})
          </button>
          <button className={tab === 'episodic' ? 'active' : ''} onClick={() => setTab('episodic')}>
            {t('Episódica', 'Episodic')} ({mem.episodic.length})
          </button>
        </div>
        <button className="btn-danger-sm" onClick={clearAll}>
          {t('Limpar tudo', 'Clear all')}
        </button>
      </div>

      {tab === 'working' && (
        <div className="working-memory">
          {/* Add new entry */}
          <div className="memory-add-row">
            <input
              placeholder={t('Chave (ex: projeto_atual)', 'Key (e.g. current_project)')}
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              className="memory-input-key"
            />
            <input
              placeholder={t('Valor', 'Value')}
              value={newVal}
              onChange={e => setNewVal(e.target.value)}
              className="memory-input-val"
              onKeyDown={e => e.key === 'Enter' && upsertEntry()}
            />
            <button onClick={upsertEntry} disabled={!newKey.trim() || saving}>
              {t('Adicionar', 'Add')}
            </button>
          </div>

          {mem.workingMemory.length === 0 && (
            <div className="memory-empty">
              {t('Nenhuma entrada na memória ativa.', 'No entries in working memory.')}
            </div>
          )}

          {mem.workingMemory.map(entry => (
            <div key={entry.key} className="memory-entry">
              {editKey === entry.key ? (
                <>
                  <span className="memory-key">{entry.key}</span>
                  <textarea
                    defaultValue={entry.value}
                    onChange={e => setEditVal(e.target.value)}
                    className="memory-edit-textarea"
                  />
                  <div className="memory-actions">
                    <button onClick={() => updateEntry(entry.key, editVal)}>{t('Salvar', 'Save')}</button>
                    <button onClick={() => setEditKey('')}>{t('Cancelar', 'Cancel')}</button>
                  </div>
                </>
              ) : (
                <>
                  <span className="memory-key">{entry.key}</span>
                  <span className="memory-val">{entry.value}</span>
                  <span className="memory-date">{new Date(entry.updatedAt).toLocaleString()}</span>
                  <div className="memory-actions">
                    <button onClick={() => { setEditKey(entry.key); setEditVal(entry.value) }}>✏️</button>
                    <button onClick={() => deleteKey(entry.key)}>🗑️</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'episodic' && (
        <div className="episodic-memory">
          {mem.episodic.length === 0 && (
            <div className="memory-empty">
              {t('Nenhuma sessão anterior registrada.', 'No previous sessions recorded.')}
            </div>
          )}
          {[...mem.episodic].reverse().map((ep, i) => (
            <div key={i} className="episodic-entry">
              <span className="ep-date">{new Date(ep.timestamp).toLocaleString()}</span>
              {ep.conversationId && (
                <span className="ep-conv-id">#{ep.conversationId.slice(-6)}</span>
              )}
              <p className="ep-summary">{ep.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
