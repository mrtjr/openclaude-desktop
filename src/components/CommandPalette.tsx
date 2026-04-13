import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Search, BookMarked, UserCog, Swords, FolderOpen, Camera, Database, GitBranch, Scale, Monitor, Image, Zap, BarChart3, Wrench, Code, ListChecks, AlertCircle, Sun, Moon, Mic, Volume2, Shield } from 'lucide-react'
import type { AppSettings } from '../Settings'
import type { PermissionLevel } from '../Settings'
import type { Persona } from '../PersonaEngine'

export interface CommandItem {
  id: string
  label: string
  description: string
  icon: any
  category: 'ai' | 'knowledge' | 'automation' | 'system'
  action: () => void
  active?: boolean
  shortcut?: string
  special?: boolean
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  language: 'pt' | 'en'
  // Feature toggles
  onOpenVault: () => void
  onOpenPersona: () => void
  onOpenArena: () => void
  onOpenCodeWorkspace: () => void
  onOpenVision: () => void
  onOpenRAG: () => void
  onOpenWorkflow: () => void
  onOpenParliament: () => void
  onOpenOrion: () => void
  onOpenAnalytics: () => void
  onOpenImageUpload: () => void
  // State toggles
  isAgentMode: boolean
  onToggleAgent: () => void
  activePersona: Persona | null
  ragEnabled: boolean
  theme: string
  onToggleTheme: () => void
  isListening: boolean
  onToggleListening: () => void
  ttsEnabled: boolean
  onToggleTTS: () => void
  // Permissions
  onSetPermission: (level: PermissionLevel) => void
  // Feature registry
  enabledFeatures?: Record<string, boolean>
  // Security
  onSecurityAudit?: () => void
}

const CATEGORY_LABELS = {
  ai: { pt: 'Inteligência Artificial', en: 'Artificial Intelligence' },
  knowledge: { pt: 'Conhecimento', en: 'Knowledge' },
  automation: { pt: 'Automação', en: 'Automation' },
  system: { pt: 'Sistema', en: 'System' },
}

export default function CommandPalette(props: CommandPaletteProps) {
  const { isOpen, onClose, settings, language } = props
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const items: CommandItem[] = [
    // AI
    { id: 'persona', label: props.activePersona?.name || (language === 'pt' ? 'Persona Engine' : 'Persona Engine'), description: language === 'pt' ? 'Personalidades de IA customizadas' : 'Custom AI personalities', icon: UserCog, category: 'ai', action: props.onOpenPersona, active: !!props.activePersona },
    { id: 'arena', label: 'Model Arena', description: language === 'pt' ? 'Compare modelos lado a lado' : 'Compare models side by side', icon: Swords, category: 'ai', action: props.onOpenArena },
    { id: 'parliament', label: language === 'pt' ? 'Parlamento' : 'Parliament', description: language === 'pt' ? 'Debate multi-agente paralelo' : 'Parallel multi-agent debate', icon: Scale, category: 'ai', action: props.onOpenParliament },
    { id: 'orion', label: 'ORION', description: language === 'pt' ? 'Controle visual do computador' : 'Visual computer control', icon: Monitor, category: 'ai', action: props.onOpenOrion, special: true },
    // Knowledge
    { id: 'vault', label: 'Prompt Vault', description: language === 'pt' ? 'Biblioteca de prompts reutilizáveis' : 'Reusable prompts library', icon: BookMarked, category: 'knowledge', action: props.onOpenVault },
    { id: 'rag', label: `RAG${props.ragEnabled ? ' ●' : ''}`, description: language === 'pt' ? 'Busca semântica em documentos' : 'Semantic document search', icon: Database, category: 'knowledge', action: props.onOpenRAG, active: props.ragEnabled },
    { id: 'workspace', label: language === 'pt' ? 'Código' : 'Code', description: language === 'pt' ? 'Editor de código com IA' : 'AI code editor', icon: FolderOpen, category: 'knowledge', action: props.onOpenCodeWorkspace },
    { id: 'image', label: language === 'pt' ? 'Anexar Imagem' : 'Attach Image', description: language === 'pt' ? 'Enviar imagem para análise' : 'Send image for analysis', icon: Image, category: 'knowledge', action: props.onOpenImageUpload },
    // Automation
    { id: 'workflow', label: language === 'pt' ? 'Workflow Builder' : 'Workflow Builder', description: language === 'pt' ? 'Automação visual de tarefas' : 'Visual task automation', icon: GitBranch, category: 'automation', action: props.onOpenWorkflow },
    { id: 'vision', label: language === 'pt' ? 'Visão' : 'Vision', description: language === 'pt' ? 'Captura e análise de tela' : 'Screen capture & analysis', icon: Camera, category: 'automation', action: props.onOpenVision },
    // System
    { id: 'agent', label: props.isAgentMode ? (language === 'pt' ? 'Desativar Agente' : 'Disable Agent') : (language === 'pt' ? 'Ativar Agente' : 'Enable Agent'), description: language === 'pt' ? 'Modo autônomo ilimitado' : 'Unlimited autonomous mode', icon: Zap, category: 'system', action: props.onToggleAgent, active: props.isAgentMode },
    { id: 'analytics', label: 'Analytics', description: language === 'pt' ? 'Dashboard de métricas' : 'Metrics dashboard', icon: BarChart3, category: 'system', action: props.onOpenAnalytics },
    { id: 'theme', label: props.theme === 'dark' ? (language === 'pt' ? 'Tema Claro' : 'Light Theme') : (language === 'pt' ? 'Tema Escuro' : 'Dark Theme'), description: language === 'pt' ? 'Alternar tema visual' : 'Toggle visual theme', icon: props.theme === 'dark' ? Sun : Moon, category: 'system', action: props.onToggleTheme },
    { id: 'voice', label: props.isListening ? (language === 'pt' ? 'Parar Voz' : 'Stop Voice') : (language === 'pt' ? 'Entrada por Voz' : 'Voice Input'), description: 'Ctrl+M', icon: Mic, category: 'system', action: props.onToggleListening, active: props.isListening },
    { id: 'tts', label: props.ttsEnabled ? (language === 'pt' ? 'Desativar TTS' : 'Disable TTS') : (language === 'pt' ? 'Ativar TTS' : 'Enable TTS'), description: language === 'pt' ? 'Leitura em voz alta' : 'Text-to-speech', icon: Volume2, category: 'system', action: props.onToggleTTS, active: props.ttsEnabled },
    // Permissions as actions
    { id: 'perm-ask', label: language === 'pt' ? 'Permissão: Solicitar' : 'Permission: Ask', description: language === 'pt' ? 'Sempre perguntar' : 'Always ask', icon: Wrench, category: 'system', action: () => props.onSetPermission('ask'), active: settings.permissionLevel === 'ask' },
    { id: 'perm-auto', label: language === 'pt' ? 'Permissão: Auto-editar' : 'Permission: Auto-edit', description: language === 'pt' ? 'Aceitar edições' : 'Accept edits', icon: Code, category: 'system', action: () => props.onSetPermission('auto_edits'), active: settings.permissionLevel === 'auto_edits' },
    { id: 'perm-plan', label: language === 'pt' ? 'Permissão: Planejar' : 'Permission: Plan', description: language === 'pt' ? 'Exigir plano' : 'Require plan', icon: ListChecks, category: 'system', action: () => props.onSetPermission('planning'), active: settings.permissionLevel === 'planning' },
    { id: 'perm-bypass', label: language === 'pt' ? 'Permissão: Bypass ⚠' : 'Permission: Bypass ⚠', description: language === 'pt' ? 'Ignorar tudo' : 'Ignore all', icon: AlertCircle, category: 'system', action: () => props.onSetPermission('ignore'), active: settings.permissionLevel === 'ignore', special: true },
    ...(props.onSecurityAudit ? [{ id: 'security-audit', label: language === 'pt' ? 'Verificação de Segurança' : 'Security Check', description: language === 'pt' ? 'Auditar configurações de segurança' : 'Audit security settings', icon: Shield, category: 'system' as const, action: () => props.onSecurityAudit!() }] : []),
  ]

  // Feature registry: map feature IDs to command palette IDs
  const FEATURE_ID_MAP: Record<string, string> = {
    persona: 'persona', arena: 'arena', parliament: 'parliament',
    orion: 'orion', vault: 'vault', rag: 'rag',
    workspace: 'workspace', workflow: 'workflow', vision: 'vision',
  }

  // Filter out disabled features
  const enabledItems = props.enabledFeatures
    ? items.filter(item => {
        const featureId = Object.entries(FEATURE_ID_MAP).find(([, cmdId]) => cmdId === item.id)?.[0]
        if (featureId && props.enabledFeatures![featureId] === false) return false
        return true
      })
    : items

  const filtered = query.trim()
    ? enabledItems.filter(item => {
        const q = query.toLowerCase()
        return item.label.toLowerCase().includes(q) ||
               item.description.toLowerCase().includes(q) ||
               item.id.includes(q)
      })
    : enabledItems

  // Group by category
  const grouped = (['ai', 'knowledge', 'automation', 'system'] as const).map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat][language],
    items: filtered.filter(i => i.category === cat)
  })).filter(g => g.items.length > 0)

  const flatItems = grouped.flatMap(g => g.items)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, flatItems.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && flatItems[selectedIdx]) {
      e.preventDefault()
      flatItems[selectedIdx].action()
      onClose()
    }
  }, [flatItems, selectedIdx, onClose])

  if (!isOpen) return null

  let flatIdx = -1

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-search-row">
          <Search size={16} className="cmd-search-icon" />
          <input
            ref={inputRef}
            className="cmd-search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={language === 'pt' ? 'Buscar comando ou ferramenta...' : 'Search command or tool...'}
          />
          <kbd className="cmd-kbd">Esc</kbd>
        </div>

        <div className="cmd-results">
          {grouped.length === 0 && (
            <div className="cmd-empty">{language === 'pt' ? 'Nenhum resultado' : 'No results'}</div>
          )}
          {grouped.map(group => (
            <div key={group.category} className="cmd-group">
              <div className="cmd-group-label">{group.label}</div>
              {group.items.map(item => {
                flatIdx++
                const idx = flatIdx
                return (
                  <div
                    key={item.id}
                    className={`cmd-item ${idx === selectedIdx ? 'selected' : ''} ${item.active ? 'active' : ''} ${item.special ? 'special' : ''}`}
                    onClick={() => { item.action(); onClose() }}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <div className={`cmd-item-icon ${item.active ? 'active' : ''}`}>
                      <item.icon size={16} />
                    </div>
                    <div className="cmd-item-info">
                      <span className="cmd-item-label">{item.label}</span>
                      <span className="cmd-item-desc">{item.description}</span>
                    </div>
                    {item.shortcut && <kbd className="cmd-kbd">{item.shortcut}</kbd>}
                    {item.active && <div className="cmd-item-dot" />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cmd-footer">
          <span>↑↓ {language === 'pt' ? 'navegar' : 'navigate'}</span>
          <span>↵ {language === 'pt' ? 'selecionar' : 'select'}</span>
          <span>Esc {language === 'pt' ? 'fechar' : 'close'}</span>
        </div>
      </div>
    </div>
  )
}
