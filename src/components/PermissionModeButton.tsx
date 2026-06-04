// ─── PermissionModeButton ────────────────────────────────────────────
//
// Claude-Anthropic-style permission mode picker anchored in the
// input-footer (bottom-left of the chat input). Click the pill to
// open a popover listing the 4 modes with numeric shortcuts (1-4).
//
// Global shortcut `Ctrl+Shift+M` toggles the popover from anywhere
// in the app; while the popover is open, pressing `1`-`4` selects
// the corresponding mode and closes the popover.
//
// Source of truth is `settings.permissionLevel` — this component is
// purely presentational + dispatches via `onChange`. No local cache
// of the chosen mode to avoid drift from Settings.tsx.

import { useEffect, useRef, useState } from 'react'
import type { PermissionLevel } from '../Settings'
import { Check, Shield, Wrench, ClipboardList, AlertCircle, ChevronUp } from 'lucide-react'

interface Props {
  value: PermissionLevel
  onChange: (level: PermissionLevel) => void
  language: 'pt' | 'en'
}

const t = (language: 'pt' | 'en', pt: string, en: string) => (language === 'pt' ? pt : en)

type Option = {
  key: PermissionLevel
  number: 1 | 2 | 3 | 4
  icon: typeof Shield
  tone: 'default' | 'accent' | 'info' | 'danger'
}

const OPTIONS: Option[] = [
  { key: 'ask',         number: 1, icon: Shield,        tone: 'default' },
  { key: 'auto_edits',  number: 2, icon: Wrench,        tone: 'accent'  },
  { key: 'planning',    number: 3, icon: ClipboardList, tone: 'info'    },
  { key: 'ignore',      number: 4, icon: AlertCircle,   tone: 'danger'  },
]

const labelOf = (key: PermissionLevel, language: 'pt' | 'en') => {
  switch (key) {
    case 'ask':        return t(language, 'Solicitar permissões', 'Ask permissions')
    case 'auto_edits': return t(language, 'Aceitar edições',       'Accept edits')
    case 'planning':   return t(language, 'Modo de planejamento',  'Plan mode')
    case 'ignore':     return t(language, 'Ignorar permissões',    'Ignore permissions')
  }
}

export default function PermissionModeButton({ value, onChange, language }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Global Ctrl+Shift+M to toggle; 1-4 to pick while open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Toggle from anywhere (Ctrl/Cmd + Shift + M)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        // Don't hijack inside inputs unless user already has the popover open;
        // Ctrl+Shift+M is obscure enough not to collide with text editing.
        e.preventDefault()
        setOpen(v => !v)
        return
      }
      if (!open) return
      if (e.key === 'Escape') { setOpen(false); return }
      if (e.key >= '1' && e.key <= '4') {
        const opt = OPTIONS.find(o => String(o.number) === e.key)
        if (opt) {
          e.preventDefault()
          onChange(opt.key)
          setOpen(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onChange])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const current = OPTIONS.find(o => o.key === value) || OPTIONS[0]

  return (
    <div ref={wrapRef} className="perm-mode-wrap">
      <button
        ref={btnRef}
        className={`perm-mode-trigger tone-${current.tone} ${open ? 'open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${t(language, 'Modo de permissão', 'Permission mode')} (Ctrl+Shift+M)`}
      >
        <span className="perm-mode-dot" aria-hidden="true" />
        <span className="perm-mode-label">{labelOf(current.key, language)}</span>
        <ChevronUp size={11} className={`perm-mode-caret ${open ? 'flip' : ''}`} />
      </button>

      {open && (
        <div className="perm-mode-popover" role="menu">
          <div className="perm-mode-popover-head">
            <span>{t(language, 'Modo', 'Mode')}</span>
            <span className="perm-mode-kbd">⇧ Ctrl M</span>
          </div>
          {OPTIONS.map(opt => {
            const Icon = opt.icon
            const active = opt.key === value
            return (
              <button
                key={opt.key}
                role="menuitem"
                className={`perm-mode-item tone-${opt.tone} ${active ? 'active' : ''}`}
                onClick={() => { onChange(opt.key); setOpen(false) }}
              >
                <Icon size={13} className="perm-mode-item-icon" />
                <span className="perm-mode-item-label">{labelOf(opt.key, language)}</span>
                {active ? (
                  <Check size={12} className="perm-mode-item-check" />
                ) : (
                  <span className="perm-mode-item-num">{opt.number}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
