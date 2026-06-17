// ─── Painel de atividade dos subagentes (v2.66.0) ───────────────────
//
// Torna visível, estilo Claude: cada subagente do delegate_subtasks aparece,
// mostra que RECEBEU a ordem, o que está FAZENDO (passo + ferramenta ao vivo) e
// o que ENTREGOU (síntese, expansível). Alimentado pelo SubagentActivityStore.

import { useState } from 'react'
import type { SubagentRun } from '../utils/subagentActivity'

interface Props {
  runs: SubagentRun[]
  language?: string
}

const TOOL_LABEL: Record<string, string> = {
  web_search: 'buscando na web',
  fetch_url: 'lendo página',
  read_file: 'lendo arquivo',
  search_files: 'procurando no código',
  list_directory: 'listando pasta',
}

function statusDot(status: SubagentRun['status']): string {
  return status === 'done' ? '#22c55e' : status === 'error' ? '#e05a5a' : '#eab308'
}

function RunRow({ run, pt }: { run: SubagentRun; pt: boolean }) {
  const [open, setOpen] = useState(false)
  const working = run.status === 'working'
  const elapsed = Math.max(0, Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000))
  const activity = working
    ? (run.lastTool
        ? (pt ? `${TOOL_LABEL[run.lastTool] || run.lastTool}…` : `${run.lastTool}…`)
        : (pt ? 'pensando…' : 'thinking…'))
    : run.status === 'done'
      ? (pt ? 'entregou' : 'delivered')
      : (pt ? 'falhou' : 'failed')

  return (
    <div style={{ borderTop: '1px solid var(--color-border, #2a2a35)', padding: '7px 2px' }}>
      <div
        onClick={() => run.result && setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: run.result ? 'pointer' : 'default', fontSize: '0.8rem' }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: statusDot(run.status),
          animation: working ? 'oc-pulse 1.2s ease-in-out infinite' : 'none',
        }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.task || (pt ? '(subtarefa)' : '(subtask)')}
        </span>
        <span style={{ color: 'var(--color-text-muted, #888)', flexShrink: 0, fontSize: '0.72rem' }}>
          {run.model} · {run.steps}↻ · {activity} · {elapsed}s
        </span>
        {run.result && (
          <span style={{ color: 'var(--color-text-muted, #888)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        )}
      </div>
      {open && run.result && (
        <pre style={{
          margin: '6px 0 2px 16px', padding: '8px 10px', fontSize: '0.76rem', lineHeight: 1.45,
          background: 'var(--bg-elevated, rgba(255,255,255,0.03))', borderRadius: 6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto',
          color: run.status === 'error' ? 'var(--color-error, #e05a5a)' : 'inherit',
        }}>{run.result}</pre>
      )}
    </div>
  )
}

export function SubagentActivityPanel({ runs, language }: Props) {
  const pt = language !== 'en'
  if (!runs.length) return null
  const working = runs.filter((r) => r.status === 'working').length
  const done = runs.filter((r) => r.status === 'done').length
  const failed = runs.filter((r) => r.status === 'error').length

  return (
    <div style={{
      margin: '0 0 10px', padding: '8px 12px',
      background: 'var(--bg-secondary, rgba(255,255,255,0.02))',
      border: '1px solid var(--color-border, #2a2a35)', borderRadius: 10,
    }}>
      <style>{`@keyframes oc-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', fontWeight: 600 }}>
        <span>{pt ? '🤖 Subagentes' : '🤖 Subagents'}</span>
        <span style={{ color: 'var(--color-text-muted, #888)', fontWeight: 400 }}>
          {working > 0 && (pt ? `${working} trabalhando` : `${working} working`)}
          {working > 0 && (done + failed > 0) ? ' · ' : ''}
          {done > 0 && (pt ? `${done} pronto${done > 1 ? 's' : ''}` : `${done} done`)}
          {failed > 0 ? (pt ? ` · ${failed} falhou` : ` · ${failed} failed`) : ''}
        </span>
      </div>
      <div style={{ marginTop: 2 }}>
        {runs.map((r) => <RunRow key={r.id} run={r} pt={pt} />)}
      </div>
    </div>
  )
}
