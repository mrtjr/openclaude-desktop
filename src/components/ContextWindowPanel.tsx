// ─── ContextWindowPanel ────────────────────────────────────────────
//
// Claude-Code-style context breakdown panel. Triggered by clicking
// the token counter in the input footer. Shows:
//   - Header: "Janela de contexto" + `used / limit (pct%)`
//   - Horizontal stacked bar color-coded by category
//   - List of categories with token count + percentage
//
// The component is a popover anchored above the trigger and closes
// on Escape / outside click. Figures come pre-computed from
// useContextBreakdown.

import { useEffect, useRef } from 'react'
import { MessageSquare, Settings as SettingsIcon, Wrench, Sparkles, Server, PackageOpen, Archive, Circle, Compass } from 'lucide-react'
import type { ContextBreakdown } from '../services/contextEngine'
import { formatTokenCount } from '../hooks/useTokenCounter'

interface Props {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
  breakdown: ContextBreakdown
  language: 'pt' | 'en'
  onCompactNow?: () => void
}

const t = (language: 'pt' | 'en', pt: string, en: string) => (language === 'pt' ? pt : en)

type Row = {
  key: string
  label: string
  tokens: number
  deferred?: boolean
  tone: string
  icon: typeof MessageSquare
}

export default function ContextWindowPanel({ open, onClose, anchorRef, breakdown, language, onCompactNow }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      const r = ref.current
      const a = anchorRef.current
      if (!r) return
      if (r.contains(e.target as Node)) return
      if (a && a.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  const limit = Math.max(1, breakdown.limit)
  const pct = (n: number) => (n / limit) * 100

  // Rows in the order Claude renders them. Deferred rows follow their
  // eager counterparts so the grouping is intuitive.
  const rows: Row[] = [
    { key: 'messages',            label: t(language, 'Mensagens',                 'Messages'),              tokens: breakdown.messages,            tone: 'messages',  icon: MessageSquare },
    { key: 'systemPrompt',        label: t(language, 'System prompt',             'System prompt'),         tokens: breakdown.systemPrompt,        tone: 'system',    icon: SettingsIcon },
    { key: 'memory',              label: t(language, 'Memória / resumo',          'Memory / summary'),      tokens: breakdown.memory,              tone: 'memory',    icon: Archive },
    { key: 'systemTools',         label: t(language, 'Ferramentas do sistema',    'System tools'),          tokens: breakdown.systemTools,         tone: 'tools',     icon: Wrench },
    { key: 'systemToolsDeferred', label: t(language, 'Ferramentas (diferidas)',   'System tools (deferred)'), tokens: breakdown.systemToolsDeferred, deferred: true, tone: 'toolsDeferred', icon: Wrench },
    { key: 'mcpTools',            label: t(language, 'Ferramentas MCP',           'MCP tools'),             tokens: breakdown.mcpTools,            tone: 'mcp',       icon: Server },
    { key: 'mcpToolsDeferred',    label: t(language, 'MCP (diferidas)',           'MCP tools (deferred)'),  tokens: breakdown.mcpToolsDeferred, deferred: true, tone: 'mcpDeferred', icon: Server },
    { key: 'skills',              label: t(language, 'Skills',                     'Skills'),                tokens: breakdown.skills,              tone: 'skills',    icon: Sparkles },
    { key: 'autocompactBuffer',   label: t(language, 'Buffer de autocompact',     'Autocompact buffer'),    tokens: breakdown.autocompactBuffer,   tone: 'buffer',    icon: PackageOpen },
    { key: 'free',                label: t(language, 'Espaço livre',              'Free space'),            tokens: breakdown.free,                tone: 'free',      icon: Circle },
  ]

  // Segments for the stacked bar — exclude deferred (they're budget,
  // not actual usage) and the free segment (gets rendered last as
  // background). Rendered in the order shown above.
  const barSegments = rows.filter(r => !r.deferred && r.key !== 'free' && r.tokens > 0)

  const criticalClass = breakdown.critical ? 'critical' : breakdown.warning ? 'warning' : ''

  return (
    <div ref={ref} className={`ctx-panel ${criticalClass}`} role="dialog" aria-label={t(language, 'Janela de contexto', 'Context window')}>
      <div className="ctx-panel-head">
        <div className="ctx-panel-title">
          <Compass size={13} />
          <span>{t(language, 'Janela de contexto', 'Context window')}</span>
        </div>
        <div className="ctx-panel-total">
          <span className="ctx-panel-used">{formatTokenCount(breakdown.used)}</span>
          <span className="ctx-panel-sep">/</span>
          <span className="ctx-panel-limit">{formatTokenCount(breakdown.limit)}</span>
          <span className="ctx-panel-pct">({breakdown.percentage}%)</span>
        </div>
      </div>

      <div className="ctx-panel-bar" role="img" aria-label={`${breakdown.percentage}% used`}>
        {barSegments.map((r) => (
          <div
            key={r.key}
            className={`ctx-panel-bar-seg tone-${r.tone}`}
            style={{ width: `${pct(r.tokens)}%` }}
            title={`${r.label}: ${formatTokenCount(r.tokens)} (${pct(r.tokens).toFixed(1)}%)`}
          />
        ))}
        <div className="ctx-panel-bar-seg tone-buffer" style={{ width: `${pct(breakdown.autocompactBuffer)}%` }}
             title={`${t(language, 'Buffer de autocompact', 'Autocompact buffer')}: ${formatTokenCount(breakdown.autocompactBuffer)}`} />
      </div>

      <ul className="ctx-panel-list">
        {rows.map((r) => {
          const Icon = r.icon
          const p = pct(r.tokens)
          if (r.tokens === 0 && (r.deferred || r.key === 'mcpTools' || r.key === 'skills')) {
            // Hide empty rows for categories that are legitimately zero
            // on a fresh install (MCP, skills, deferred off).
            return null
          }
          return (
            <li key={r.key} className={`ctx-panel-row ${r.deferred ? 'deferred' : ''}`}>
              <span className={`ctx-panel-row-swatch tone-${r.tone}`} aria-hidden="true" />
              <Icon size={12} className="ctx-panel-row-icon" />
              <span className="ctx-panel-row-label">{r.label}</span>
              <span className="ctx-panel-row-tokens">{formatTokenCount(r.tokens)}</span>
              <span className="ctx-panel-row-pct">{p < 0.1 && r.tokens > 0 ? '<0.1%' : `${p.toFixed(1)}%`}</span>
            </li>
          )
        })}
      </ul>

      {breakdown.shouldAutocompact && onCompactNow && (
        <div className="ctx-panel-alert">
          <span>
            {t(language,
              'Perto do limite — rodar autocompact agora libera espaço.',
              'Near the limit — running autocompact now will free space.')}
          </span>
          <button className="ctx-panel-compact-btn" onClick={() => { onCompactNow(); onClose() }}>
            {t(language, 'Compactar agora', 'Compact now')}
          </button>
        </div>
      )}

      <div className="ctx-panel-foot">
        {t(language,
          'Contagem por tokenizer real (o200k_base) — exata p/ OpenAI, aproximada p/ os demais. Deferred = sob demanda via tool_search.',
          'Real tokenizer counts (o200k_base) — exact for OpenAI, approximate for others. Deferred = on-demand via tool_search.')}
      </div>
    </div>
  )
}
