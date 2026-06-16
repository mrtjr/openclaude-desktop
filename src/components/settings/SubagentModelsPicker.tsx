// ─── Seletor multi-modelo dos subagentes (v2.64.0) ──────────────────
//
// Busca os modelos Ollama REALMENTE instalados (IPC list-provider-models) e
// deixa o usuário marcar quais os subagentes podem usar. O orquestrador escolhe
// o melhor por subtarefa (campo "model" do delegate_subtasks) ou faz rodízio.
// Componente isolado p/ não tocar a área de hooks do Settings.

import { useState, useEffect, useCallback } from 'react'

interface Props {
  /** Modelos marcados (allowlist). */
  selected: string[]
  onChange: (next: string[]) => void
  /** Modelo padrão usado quando nada está marcado. */
  fallbackModel: string
  onFallbackChange: (m: string) => void
  language: string
}

export function SubagentModelsPicker({ selected, onChange, fallbackModel, onFallbackChange, language }: Props) {
  const pt = language === 'pt'
  const [installed, setInstalled] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      // list-models = lister local do Ollama (/api/tags → {models:[{name}]}).
      const res = await (window as any).electron.listModels()
      const names = Array.isArray(res?.models)
        ? res.models.map((m: any) => (typeof m === 'string' ? m : m?.name)).filter(Boolean)
        : []
      setInstalled(names)
    } catch (e: any) {
      setErr(e?.message || 'erro')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  const toggle = (m: string) => {
    onChange(selected.includes(m) ? selected.filter((x) => x !== m) : [...selected, m])
  }

  // União: instalados + marcados que não aparecem (preserva a seleção mesmo se o
  // Ollama estiver fora do ar na hora de abrir as Configurações).
  const all = Array.from(new Set([...(installed || []), ...(selected || [])]))

  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #888)' }}>
          {pt ? 'Modelos permitidos (o orquestrador escolhe por subtarefa)' : 'Allowed models (orchestrator picks per subtask)'}
        </span>
        <button
          type="button"
          onClick={fetchModels}
          disabled={loading}
          style={{ fontSize: '0.75rem', padding: '2px 8px', cursor: loading ? 'default' : 'pointer' }}
        >
          {loading ? '…' : (pt ? 'Atualizar' : 'Refresh')}
        </button>
      </div>

      {err && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-error, #e05a5a)', margin: '0 0 6px' }}>
          {pt ? 'Ollama não respondeu — verifique se está rodando.' : 'Ollama did not respond — check it is running.'}
        </p>
      )}
      {all.length === 0 && !loading && !err && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #888)', margin: '0 0 6px' }}>
          {pt ? 'Nenhum modelo instalado encontrado. Use o padrão abaixo.' : 'No installed models found. Use the default below.'}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', maxHeight: 140, overflowY: 'auto' }}>
        {all.map((m) => (
          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(m)} onChange={() => toggle(m)} />
            <span>{m}</span>
          </label>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #888)', display: 'block', marginBottom: 4 }}>
          {pt ? 'Modelo padrão (fallback quando nada marcado)' : 'Default model (fallback when none checked)'}
        </label>
        <input
          type="text"
          value={fallbackModel}
          onChange={(e) => onFallbackChange(e.target.value)}
          placeholder="llama3.2"
          style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', maxWidth: 260 }}
        />
      </div>
    </div>
  )
}
