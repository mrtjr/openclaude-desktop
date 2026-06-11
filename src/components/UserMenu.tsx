// ─── UserMenu ────────────────────────────────────────────────────────
//
// Claude-Desktop-style popover anchored above the sidebar-user trigger.
// Since v2.12.3 this is the single home for user preferences that used
// to live scattered in the titlebar: theme, accent, language,
// settings, agent dashboard. The old Supabase-based AccountPanel was
// removed — OpenClaude is local-only, there is no "account" to sign
// into, so the header now shows an editable local profile name
// instead of an email.
//
// Closes on Escape, outside click, or after executing any action.
// Submenus open inline (accordion) to avoid edge-of-screen flyout bugs.

import { useEffect, useRef, useState } from 'react'
import {
  Settings as SettingsIcon,
  Languages,
  HelpCircle,
  Package,
  Info,
  ChevronRight,
  ChevronDown,
  Activity,
  ExternalLink,
  Check,
  Palette,
  Sun,
  Pencil,
  Download,
  Upload,
} from 'lucide-react'

export interface UserMenuProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
  language: 'pt' | 'en'
  onLanguageChange: (lang: 'pt' | 'en') => void
  profileName: string
  onProfileNameChange: (name: string) => void
  onOpenSettings: () => void
  onOpenDashboard: () => void
  onOpenAccentPicker: () => void
  onCycleTheme: () => void
  themeLabel: string
  appVersion: string
  onExportData: () => void
  onImportData: () => void
}

const t = (language: 'pt' | 'en', pt: string, en: string) => (language === 'pt' ? pt : en)

const openExternal = (url: string) => {
  const el = (window as any).electron
  if (el?.openTarget) el.openTarget(url)
  else window.open(url, '_blank')
}

export default function UserMenu(props: UserMenuProps) {
  const { open, onClose, anchorRef, language, profileName, onProfileNameChange, onOpenSettings, onOpenDashboard, onOpenAccentPicker, onCycleTheme, themeLabel, appVersion, onExportData, onImportData } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const [openSub, setOpenSub] = useState<null | 'language' | 'about'>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(profileName)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Close on escape + outside click
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      const m = menuRef.current
      const a = anchorRef.current
      if (!m) return
      if (m.contains(e.target as Node)) return
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

  useEffect(() => { if (!open) { setOpenSub(null); setEditingName(false); setNameDraft(profileName) } }, [open, profileName])
  useEffect(() => { if (editingName) nameInputRef.current?.focus() }, [editingName])

  if (!open) return null

  const act = (fn: () => void) => () => { fn(); onClose() }

  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== profileName) onProfileNameChange(trimmed)
    else setNameDraft(profileName)
    setEditingName(false)
  }

  return (
    <div ref={menuRef} className="user-menu" role="menu">
      {/* Header: editable local profile name (no email / auth) */}
      <div className="user-menu-header">
        {editingName ? (
          <input
            ref={nameInputRef}
            className="user-menu-name-input"
            value={nameDraft}
            maxLength={40}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') { setNameDraft(profileName); setEditingName(false) }
            }}
            placeholder={t(language, 'Seu nome', 'Your name')}
          />
        ) : (
          <button className="user-menu-name-display" onClick={() => setEditingName(true)} title={t(language, 'Editar nome', 'Edit name')}>
            <span className="user-menu-name-text">{profileName}</span>
            <Pencil size={11} className="user-menu-name-pencil" />
          </button>
        )}
        <div className="user-menu-subhead">{t(language, 'Modo local · sem conta', 'Local mode · no account')}</div>
      </div>

      <div className="user-menu-divider" />

      {/* Settings */}
      <button className="user-menu-item" role="menuitem" onClick={act(onOpenSettings)}>
        <SettingsIcon size={14} />
        <span>{t(language, 'Configurações', 'Settings')}</span>
        <span className="user-menu-kbd">Ctrl+,</span>
      </button>

      {/* Language */}
      <button
        className={`user-menu-item user-menu-submenu-trigger ${openSub === 'language' ? 'expanded' : ''}`}
        role="menuitem"
        onClick={() => setOpenSub(openSub === 'language' ? null : 'language')}
      >
        <Languages size={14} />
        <span>{t(language, 'Idioma', 'Language')}</span>
        {openSub === 'language' ? <ChevronDown size={12} className="user-menu-caret" /> : <ChevronRight size={12} className="user-menu-caret" />}
      </button>
      {openSub === 'language' && (
        <div className="user-menu-submenu">
          <button className="user-menu-item user-menu-subitem" onClick={act(() => props.onLanguageChange('pt'))}>
            <span className="user-menu-sublabel">Português</span>
            {language === 'pt' && <Check size={12} className="user-menu-check" />}
          </button>
          <button className="user-menu-item user-menu-subitem" onClick={act(() => props.onLanguageChange('en'))}>
            <span className="user-menu-sublabel">English</span>
            {language === 'en' && <Check size={12} className="user-menu-check" />}
          </button>
        </div>
      )}

      {/* Theme (cycles dark → light → oled) — kept here AND as inline
          icon next to avatar; the menu entry gives the full label so
          discoverable users know the 3-state cycle exists. */}
      <button className="user-menu-item" role="menuitem" onClick={act(onCycleTheme)} title={themeLabel}>
        <Sun size={14} />
        <span>{t(language, 'Tema', 'Theme')}</span>
        <span className="user-menu-hint">{themeLabel.split(' ')[1]?.replace(':', '').replace(/[()]/g, '') || ''}</span>
      </button>

      {/* Accent color */}
      <button className="user-menu-item" role="menuitem" onClick={act(onOpenAccentPicker)}>
        <Palette size={14} />
        <span>{t(language, 'Cor de destaque', 'Accent color')}</span>
      </button>

      {/* Agent Dashboard — moved from titlebar per user request */}
      <button className="user-menu-item" role="menuitem" onClick={act(onOpenDashboard)}>
        <Activity size={14} />
        <span>{t(language, 'Dashboard do agente', 'Agent dashboard')}</span>
        <span className="user-menu-kbd">Ctrl+⇧D</span>
      </button>

      <div className="user-menu-divider" />

      {/* Backup — export/import the whole local corpus (additive, v2.12.62) */}
      <button className="user-menu-item" role="menuitem" onClick={act(onExportData)}>
        <Download size={14} />
        <span>{t(language, 'Exportar dados (backup)', 'Export data (backup)')}</span>
      </button>
      <button className="user-menu-item" role="menuitem" onClick={act(onImportData)}>
        <Upload size={14} />
        <span>{t(language, 'Importar dados', 'Import data')}</span>
      </button>

      <div className="user-menu-divider" />

      {/* Help */}
      <button className="user-menu-item" role="menuitem" onClick={act(() => openExternal('https://github.com/Gitlawb/openclaude/blob/main/README.md'))}>
        <HelpCircle size={14} />
        <span>{t(language, 'Receber ajuda', 'Get help')}</span>
        <ExternalLink size={10} className="user-menu-ext" />
      </button>

      {/* Apps & extensions */}
      <button className="user-menu-item" role="menuitem" onClick={act(() => openExternal('https://github.com/Gitlawb/openclaude/releases'))}>
        <Package size={14} />
        <span>{t(language, 'Obter apps e extensões', 'Get apps & extensions')}</span>
        <ExternalLink size={10} className="user-menu-ext" />
      </button>

      {/* About submenu */}
      <button
        className={`user-menu-item user-menu-submenu-trigger ${openSub === 'about' ? 'expanded' : ''}`}
        role="menuitem"
        onClick={() => setOpenSub(openSub === 'about' ? null : 'about')}
      >
        <Info size={14} />
        <span>{t(language, 'Saiba mais', 'Learn more')}</span>
        {openSub === 'about' ? <ChevronDown size={12} className="user-menu-caret" /> : <ChevronRight size={12} className="user-menu-caret" />}
      </button>
      {openSub === 'about' && (
        <div className="user-menu-submenu">
          <button className="user-menu-item user-menu-subitem" onClick={act(() => openExternal('https://github.com/Gitlawb/openclaude'))}>
            <span className="user-menu-sublabel">GitHub</span>
            <ExternalLink size={10} className="user-menu-ext" />
          </button>
          <button className="user-menu-item user-menu-subitem" onClick={act(() => openExternal('https://github.com/Gitlawb/openclaude/blob/main/CHANGELOG.md'))}>
            <span className="user-menu-sublabel">Changelog</span>
            <ExternalLink size={10} className="user-menu-ext" />
          </button>
          <div className="user-menu-subitem user-menu-version" aria-disabled>
            <span className="user-menu-sublabel">OpenClaude Desktop v{appVersion}</span>
          </div>
        </div>
      )}
    </div>
  )
}
