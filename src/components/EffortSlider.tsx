// ─── EffortSlider ───────────────────────────────────────────────────
//
// Controle de esforço por-conversa no compositor, no estilo do slider
// "Faster ↔ Smarter" do Claude Code. Mora ao lado do PermissionModeButton no
// input-status-bar. Reusa o pipeline reasoningEffort existente (v2.25.0): o
// valor escolhido é gravado na conversa ativa e sobrepõe o default global.
//
// value = override da conversa (undefined = herda o padrão global de Settings).
// 'auto' = modo adaptativo (heurística por turno, ver utils/adaptiveEffort).

import { useEffect, useRef, useState } from 'react'
import { Gauge, ChevronUp, Sparkles, Check } from 'lucide-react'
import type { ReasoningEffort } from '../settingsConfig'

interface Props {
  /** Override da conversa; undefined = herdar o padrão global. */
  value: ReasoningEffort | undefined
  /** Padrão global (Settings) — mostrado no item "Herdar". */
  globalDefault: ReasoningEffort
  onChange: (v: ReasoningEffort | undefined) => void
  language: 'pt' | 'en'
}

const t = (lang: 'pt' | 'en', pt: string, en: string) => (lang === 'pt' ? pt : en)

// Eixo "mais rápido → mais inteligente" do slider (4 paradas concretas).
const AXIS: ReasoningEffort[] = ['off', 'low', 'medium', 'high']

const shortLabel = (v: ReasoningEffort | undefined, lang: 'pt' | 'en'): string => {
  switch (v) {
    case 'auto': return t(lang, 'Auto', 'Auto')
    case 'off': return t(lang, 'Rápido', 'Fast')
    case 'low': return t(lang, 'Baixo', 'Low')
    case 'medium': return t(lang, 'Médio', 'Medium')
    case 'high': return t(lang, 'Alto', 'High')
    case 'default': return t(lang, 'Padrão', 'Default')
    default: return t(lang, 'Padrão', 'Default') // undefined = herda
  }
}

export default function EffortSlider({ value, globalDefault, onChange, language }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const isAuto = value === 'auto'
  // Posição do slider: o nível concreto atual; se auto/herdado, mostra o efetivo.
  const effective: ReasoningEffort = value && value !== 'auto' && value !== 'default'
    ? value
    : (globalDefault !== 'auto' && globalDefault !== 'default' ? globalDefault : 'medium')
  const sliderIdx = Math.max(0, AXIS.indexOf(effective))

  return (
    <div ref={wrapRef} className="effort-wrap">
      <button
        className={`effort-trigger ${open ? 'open' : ''} ${isAuto ? 'is-auto' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t(language, 'Esforço de raciocínio', 'Reasoning effort')}
      >
        {isAuto ? <Sparkles size={12} /> : <Gauge size={12} />}
        <span className="effort-trigger-label">{t(language, 'Esforço', 'Effort')}: {shortLabel(value, language)}</span>
        <ChevronUp size={11} className={`effort-caret ${open ? 'flip' : ''}`} />
      </button>

      {open && (
        <div className="effort-popover" role="menu">
          <div className="effort-popover-head">{t(language, 'Esforço de raciocínio', 'Reasoning effort')}</div>

          {/* Modo automático (adaptativo) */}
          <button
            className={`effort-mode-btn ${isAuto ? 'active' : ''}`}
            onClick={() => { onChange('auto'); setOpen(false) }}
          >
            <Sparkles size={13} />
            <span>{t(language, 'Automático (adapta à tarefa)', 'Auto (adapts to the task)')}</span>
            {isAuto && <Check size={12} className="effort-check" />}
          </button>

          {/* Slider Mais rápido ↔ Mais inteligente */}
          <div className={`effort-slider-row ${isAuto ? 'dimmed' : ''}`}>
            <span className="effort-end">{t(language, 'Mais rápido', 'Faster')}</span>
            <input
              type="range" min={0} max={AXIS.length - 1} step={1}
              value={sliderIdx}
              onChange={(e) => onChange(AXIS[Number(e.target.value)])}
              className="effort-range"
              aria-label={t(language, 'Esforço', 'Effort')}
            />
            <span className="effort-end">{t(language, 'Mais inteligente', 'Smarter')}</span>
          </div>
          <div className="effort-slider-value">{shortLabel(value && value !== 'auto' ? value : effective, language)}</div>

          {/* Herdar o padrão global */}
          <button
            className={`effort-mode-btn subtle ${value === undefined ? 'active' : ''}`}
            onClick={() => { onChange(undefined); setOpen(false) }}
          >
            <span>{t(language, 'Herdar padrão global', 'Inherit global default')} ({shortLabel(globalDefault, language)})</span>
            {value === undefined && <Check size={12} className="effort-check" />}
          </button>
        </div>
      )}
    </div>
  )
}
