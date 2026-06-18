// ─── Painel de atividade dos subagentes (v2.68.0 — redesign) ────────
//
// Compacto, colapsável e ANIMADO (antes: bloco fixo, largo de ponta a ponta,
// tempo congelado). Mostra estilo Claude: recebeu → trabalhando (spinner +
// ferramenta ao vivo + cronômetro que tica) → entregou (✓, expansível).
// Alimentado pelo SubagentActivityStore.

import { useState, useEffect } from 'react'
import type { SubagentRun, SubagentStatus } from '../utils/subagentActivity'

interface Props {
  runs: SubagentRun[]
  language?: string
}

const TOOL_LABEL_PT: Record<string, string> = {
  web_search: 'buscando na web', fetch_url: 'lendo página', read_file: 'lendo arquivo',
  search_files: 'procurando no código', list_directory: 'listando pasta',
}
const TOOL_LABEL_EN: Record<string, string> = {
  web_search: 'searching the web', fetch_url: 'reading page', read_file: 'reading file',
  search_files: 'searching code', list_directory: 'listing folder',
}

const COLOR: Record<SubagentStatus, string> = { working: '#eab308', done: '#22c55e', error: '#ef4444' }

function fmtElapsed(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m${String(s).padStart(2, '0')}s`
}

function StatusIcon({ status }: { status: SubagentStatus }) {
  const c = COLOR[status]
  if (status === 'working') {
    return (
      <span style={{
        width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${c}40`, borderTopColor: c,
        display: 'inline-block', animation: 'oc-spin 0.7s linear infinite',
      }} />
    )
  }
  return (
    <span style={{
      width: 13, height: 13, borderRadius: '50%', flexShrink: 0, color: '#fff',
      background: c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, fontWeight: 700, lineHeight: 1,
    }}>{status === 'done' ? '✓' : '✕'}</span>
  )
}

function RunRow({ run, pt, now }: { run: SubagentRun; pt: boolean; now: number }) {
  const [open, setOpen] = useState(false)
  const working = run.status === 'working'
  const elapsed = Math.max(0, Math.round(((run.endedAt ?? now) - run.startedAt) / 1000))
  const labels = pt ? TOOL_LABEL_PT : TOOL_LABEL_EN
  const activity = working
    ? (run.lastTool ? `${labels[run.lastTool] || run.lastTool}…` : (pt ? 'pensando…' : 'thinking…'))
    : run.status === 'done' ? (pt ? 'entregou' : 'delivered') : (pt ? 'falhou' : 'failed')
  const activityColor = working ? 'var(--color-text-muted, #8a8a96)' : COLOR[run.status]
  // Subagentes aninhados (v2.88.0): indenta por profundidade (1 = raiz) e marca
  // os filhos com um conector de árvore.
  const depth = Math.max(1, run.depth || 1)
  const indent = (depth - 1) * 16

  return (
    <div style={{ animation: 'oc-row-in 0.25s ease' }}>
      <div
        onClick={() => run.result && setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '6px 4px', paddingLeft: 4 + indent,
          cursor: run.result ? 'pointer' : 'default', fontSize: '0.78rem',
          borderRadius: 6, transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { if (run.result) (e.currentTarget.style.background = 'var(--bg-elevated, rgba(255,255,255,0.04))') }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {depth > 1 && <span style={{ color: 'var(--color-text-muted, #8a8a96)', opacity: 0.6, flexShrink: 0, fontSize: '0.78rem' }}>↳</span>}
        <StatusIcon status={run.status} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.task || (pt ? '(subtarefa)' : '(subtask)')}
        </span>
        <span style={{
          flexShrink: 0, fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums',
          color: 'var(--color-text-muted, #8a8a96)', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ opacity: 0.7 }}>{run.model}</span>
          <span style={{ color: activityColor, fontWeight: working ? 400 : 600 }}>{activity}</span>
          <span style={{ opacity: 0.85 }}>{fmtElapsed(elapsed)}</span>
        </span>
        {run.result && (
          <span style={{ color: 'var(--color-text-muted, #8a8a96)', flexShrink: 0, fontSize: '0.7rem', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
        )}
      </div>
      {open && run.result && (
        <pre style={{
          margin: '2px 0 6px 24px', padding: '9px 11px', fontSize: '0.75rem', lineHeight: 1.5,
          background: 'var(--bg-elevated, rgba(255,255,255,0.035))', borderRadius: 7,
          border: '1px solid var(--color-border, #2a2a35)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflowY: 'auto',
          animation: 'oc-row-in 0.2s ease',
          color: run.status === 'error' ? COLOR.error : 'inherit',
        }}>{run.result}</pre>
      )}
    </div>
  )
}

export function SubagentActivityPanel({ runs, language }: Props) {
  const pt = language !== 'en'
  const [open, setOpen] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  const anyWorking = runs.some((r) => r.status === 'working')

  // Cronômetro vivo: tica a cada 1s ENQUANTO houver worker trabalhando, para o
  // tempo decorrido subir suavemente (antes só atualizava nos eventos → parecia
  // congelado). Para quando todos terminam (endedAt fixa o tempo final).
  useEffect(() => {
    if (!anyWorking) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyWorking])

  if (!runs.length) return null

  const working = runs.filter((r) => r.status === 'working').length
  const done = runs.filter((r) => r.status === 'done').length
  const failed = runs.filter((r) => r.status === 'error').length

  const summary = [
    working > 0 && (pt ? `${working} trabalhando` : `${working} working`),
    done > 0 && (pt ? `${done} pronto${done > 1 ? 's' : ''}` : `${done} done`),
    failed > 0 && (pt ? `${failed} falhou` : `${failed} failed`),
  ].filter(Boolean).join(' · ')

  return (
    <div style={{
      maxWidth: 820, margin: '0 auto 10px', overflow: 'hidden',
      background: 'var(--bg-secondary, rgba(255,255,255,0.025))',
      border: '1px solid var(--color-border, #2a2a35)', borderRadius: 12,
      boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      animation: 'oc-bar-in 0.3s ease',
    }}>
      <style>{`
        @keyframes oc-spin { to { transform: rotate(360deg) } }
        @keyframes oc-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        @keyframes oc-row-in { from { opacity: 0; transform: translateY(-3px) } to { opacity: 1; transform: none } }
        @keyframes oc-bar-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
      `}</style>

      {/* Cabeçalho clicável (colapsa/expande) */}
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {anyWorking
          ? <StatusIcon status="working" />
          : <span style={{ fontSize: 13, lineHeight: 1 }}>{failed > 0 ? '⚠️' : '✅'}</span>}
        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{pt ? 'Subagentes' : 'Subagents'}</span>
        <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted, #8a8a96)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
        <span style={{
          fontSize: '0.7rem', color: 'var(--color-text-muted, #8a8a96)', flexShrink: 0,
          transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none',
        }}>▸</span>
      </div>

      {/* Corpo (lista de workers) */}
      {open && (
        <div style={{
          padding: '2px 8px 8px', borderTop: '1px solid var(--color-border, #2a2a35)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {runs.map((r) => <RunRow key={r.id} run={r} pt={pt} now={now} />)}
        </div>
      )}
    </div>
  )
}
