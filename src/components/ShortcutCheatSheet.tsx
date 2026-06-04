// ─── Keyboard Shortcut Cheat Sheet (v2.12.0) ───────────────────────
// Press `?` anywhere (outside a text field) to open.
// Single-responsibility: display, don't register. The actual keybinds
// live in App.tsx's global keydown handler — this modal just documents
// them so users can discover features without hunting through menus.

import { X, Command } from 'lucide-react'

export interface ShortcutCheatSheetProps {
  isOpen: boolean
  onClose: () => void
  language: 'pt' | 'en'
}

interface Shortcut {
  keys: string[]
  label: { pt: string; en: string }
}

interface Group {
  title: { pt: string; en: string }
  items: Shortcut[]
}

const GROUPS: Group[] = [
  {
    title: { pt: 'Navegação', en: 'Navigation' },
    items: [
      { keys: ['Ctrl', 'N'], label: { pt: 'Nova conversa', en: 'New conversation' } },
      { keys: ['Ctrl', 'K'], label: { pt: 'Paleta de comandos', en: 'Command palette' } },
      { keys: ['Ctrl', ','], label: { pt: 'Abrir configurações', en: 'Open settings' } },
      { keys: ['Ctrl', '\\'], label: { pt: 'Alternar sidebar', en: 'Toggle sidebar' } },
      { keys: ['Ctrl', 'Shift', 'D'], label: { pt: 'Painel do Agente', en: 'Agent Dashboard' } },
      { keys: ['/'], label: { pt: 'Focar caixa de mensagem', en: 'Focus composer' } },
      { keys: ['?'], label: { pt: 'Este painel', en: 'This cheat sheet' } },
      { keys: ['Esc'], label: { pt: 'Fechar modal aberto', en: 'Close open modal' } },
    ],
  },
  {
    title: { pt: 'Recursos', en: 'Features' },
    items: [
      { keys: ['Ctrl', 'P'], label: { pt: 'Persona Engine', en: 'Persona Engine' } },
      { keys: ['Ctrl', 'Shift', 'V'], label: { pt: 'Modo Visão', en: 'Vision Mode' } },
    ],
  },
  {
    title: { pt: 'Chat', en: 'Chat' },
    items: [
      { keys: ['Enter'], label: { pt: 'Enviar mensagem', en: 'Send message' } },
      { keys: ['Shift', 'Enter'], label: { pt: 'Nova linha', en: 'New line' } },
      { keys: ['/clear'], label: { pt: 'Nova conversa (slash)', en: 'New conversation (slash)' } },
      { keys: ['/regen'], label: { pt: 'Regenerar última resposta', en: 'Regenerate last' } },
      { keys: ['/model'], label: { pt: 'Trocar modelo', en: 'Switch model' } },
      { keys: ['/theme'], label: { pt: 'Alternar tema', en: 'Cycle theme' } },
      { keys: ['Ctrl', 'M'], label: { pt: 'Entrada por voz', en: 'Voice input' } },
    ],
  },
]

function KeyCap({ k }: { k: string }) {
  // Render ⌘ icon for Ctrl on mac-class platforms? Not worth the bloat
  // — users see Ctrl consistently and every OS handles it.
  if (k === 'Ctrl') return <kbd className="shortcut-key" aria-label="Control"><Command size={10} style={{ verticalAlign: 'middle' }} /> Ctrl</kbd>
  return <kbd className="shortcut-key">{k}</kbd>
}

export default function ShortcutCheatSheet({ isOpen, onClose, language }: ShortcutCheatSheetProps) {
  if (!isOpen) return null

  return (
    <div
      className="analytics-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <div
        className="analytics-modal shortcut-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={language === 'pt' ? 'Atalhos do teclado' : 'Keyboard shortcuts'}
      >
        <div className="analytics-header">
          <h2>{language === 'pt' ? 'Atalhos do teclado' : 'Keyboard Shortcuts'}</h2>
          <button className="analytics-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="shortcut-body">
          {GROUPS.map(g => (
            <div key={g.title.en} className="shortcut-group">
              <div className="shortcut-group-title">{g.title[language]}</div>
              {g.items.map((s, i) => (
                <div key={i} className="shortcut-row">
                  <span className="shortcut-label">{s.label[language]}</span>
                  <span className="shortcut-keys">
                    {s.keys.map((k, idx) => (
                      <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <KeyCap k={k} />
                        {idx < s.keys.length - 1 && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>+</span>}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
