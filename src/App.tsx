import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react'
import 'highlight.js/styles/github-dark.css'
import { Send, Plus, Trash2, Minus, Square, X, Bot, User, Loader2, ChevronDown, Wrench, Terminal, Search, Settings as SettingsIcon, Download, FileText, XCircle, MessageSquare, Play, Code, Globe, FileCode, Info, ArrowUpCircle, Zap, BotOff, Copy, RefreshCw, Pin, PanelLeftClose, PanelLeft, Sun, Moon, Image, Trash, Mic, MicOff, Volume2, ListChecks, CheckCircle2, Circle, AlertCircle, Clock, BarChart3, Scale, Camera, Database, BookMarked, Swords, FolderOpen, GitBranch, Monitor, UserCog } from 'lucide-react'
import SettingsModal, { loadSettings, type AppSettings } from './Settings'
import type { Persona } from './PersonaEngine'
// Small / hot-path components — eager
import CommandPalette from './components/CommandPalette'
import Toasts from './components/Toasts'
import OnboardingModal from './components/OnboardingModal'
import CopyButton from './components/CopyButton'

// Heavy feature panels — lazy-loaded on first use.
// Saves ~1MB from initial bundle; each chunk loads async when user opens the modal.
const AnalyticsDashboard = lazy(() => import('./Analytics'))
const ParliamentMode = lazy(() => import('./Parliament'))
const PromptVault = lazy(() => import('./PromptVault'))
const PersonaEngine = lazy(() => import('./PersonaEngine'))
const ModelArena = lazy(() => import('./ModelArena'))
const CodeWorkspace = lazy(() => import('./CodeWorkspace'))
const VisionMode = lazy(() => import('./VisionMode'))
const RAGPanel = lazy(() => import('./RAGPanel'))
const ORION = lazy(() => import('./ORION'))
const WorkflowBuilder = lazy(() => import('./WorkflowBuilder'))
const ProfilesPanel = lazy(() => import('./ProfilesPanel'))
const ScheduledTasksPanel = lazy(() => import('./ScheduledTasksPanel'))
const AccountPanel = lazy(() => import('./AccountPanel'))

// ─── Extracted modules ──────────────────────────────────────────────
import type { Message } from './types'
import { PLACEHOLDER_HINTS, SUGGESTIONS } from './constants/prompts'
import { formatMarkdown, getRelativeTime } from './utils/formatting'

// ─── Custom hooks ───────────────────────────────────────────────────
import { useProviderConfig, getDisplayModel } from './hooks/useProviderConfig'
import { useVoice } from './hooks/useVoice'
import { useConversations } from './hooks/useConversations'
import { useToolExecution } from './hooks/useToolExecution'
import { useModalKeyPool } from './hooks/useModalKeyPool'
import { useChat } from './hooks/useChat'
import { useProviderHealth } from './hooks/useProviderHealth'
import { useTokenCounter, formatTokenCount } from './hooks/useTokenCounter'
import { useUsageTracking } from './hooks/useUsageTracking'
import { loadEnabledFeatures, saveEnabledFeatures, isFeatureEnabled } from './config/features'
import { useMemoryDreaming } from './hooks/useMemoryDreaming'
import { useProfiles } from './hooks/useProfiles'
import { useScheduledTasks } from './hooks/useScheduledTasks'
import { runSecurityAudit } from './utils/securityAudit'
import { useToast } from './hooks/useToast'
import { useAuth } from './hooks/useAuth'
import { useSync } from './hooks/useSync'

// ─── App ─────────────────────────────────────────────────────────────
export default function App() {
  const [input, setInput] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('openclaude-model') || 'qwen35-uncensored')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [ollamaOnline, setOllamaOnline] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set())
  const [taskPlanCollapsed, setTaskPlanCollapsed] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<{available: boolean, releaseUrl: string, latestVersion: string} | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    // Priority: explicit user choice > OS preference > dark default
    const saved = localStorage.getItem('openclaude-theme')
    if (saved === 'dark' || saved === 'light') return saved
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return 'light'
    }
    return 'dark'
  })
  const [isAgentMode, setIsAgentMode] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showParliament, setShowParliament] = useState(false)
  // ── Feature states ────────────────────────────────────────────────
  const [showVault, setShowVault] = useState(false)
  const [showPersona, setShowPersona] = useState(false)
  const [showArena, setShowArena] = useState(false)
  const [showRAG, setShowRAG] = useState(false)
  const [showWorkflow, setShowWorkflow] = useState(false)
  const [showOrion, setShowOrion] = useState(false)
  const [showVision, setShowVision] = useState(false)
  const [showCodeWorkspace, setShowCodeWorkspace] = useState(false)
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null)
  const [activePersona, setActivePersona] = useState<Persona | null>(null)
  const [ragEnabled, setRagEnabled] = useState(false)
  const [showFeatureMenu, setShowFeatureMenu] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showProfiles, setShowProfiles] = useState(false)
  const [showScheduler, setShowScheduler] = useState(false)
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean>>(loadEnabledFeatures)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isNearBottomRef = useRef(true)

  const { toasts, show: showToast, dismiss: dismissToast, success: toastSuccess, error: toastError } = useToast()
  // Suppress unused warnings — helpers available for future callers
  void toastSuccess; void toastError

  // ─── Accounts & Cloud Sync (v2.7.0) ───────────────────────────
  const auth = useAuth()
  const sync = useSync({
    session: auth.session,
    passphrase: auth.passphrase,
    // Snapshot: what to push. Keep minimal & safe for v0.
    snapshotProvider: () => ({
      settings: {
        theme, language: settings.language, provider: settings.provider,
        // other non-secret preferences can grow over time
      },
      apiKeys: {
        openai: settings.openaiApiKey || '',
        anthropic: settings.anthropicApiKey || '',
        gemini: settings.geminiApiKey || '',
        openrouter: settings.openrouterApiKey || '',
        modal: settings.modalApiKey || '',
        customApiKey: (settings as any).customApiKey || '',
      },
    }),
    applySnapshot: (snap) => {
      if (snap.settings) {
        const remote = snap.settings.data || {}
        if (remote.theme && (remote.theme === 'dark' || remote.theme === 'light')) setTheme(remote.theme)
        const next: AppSettings = { ...settings }
        if (remote.language) (next as any).language = remote.language
        if (remote.provider) (next as any).provider = remote.provider
        setSettings(next); localStorage.setItem('openclaude-settings', JSON.stringify(next))
      }
      if (snap.apiKeys) {
        const keys = snap.apiKeys.data || {}
        const next: AppSettings = {
          ...settings,
          openaiApiKey: keys.openai ?? settings.openaiApiKey,
          anthropicApiKey: keys.anthropic ?? settings.anthropicApiKey,
          geminiApiKey: keys.gemini ?? settings.geminiApiKey,
          openrouterApiKey: keys.openrouter ?? settings.openrouterApiKey,
          modalApiKey: keys.modal ?? settings.modalApiKey,
          ...(keys.customApiKey ? { customApiKey: keys.customApiKey } : {}),
        } as any
        setSettings(next); localStorage.setItem('openclaude-settings', JSON.stringify(next))
      }
    },
  })

  // ─── First-run onboarding ─────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('oc.onboarded')
  })

  // ─── Agent Profiles ────────────────────────────────────────────
  const profiles = useProfiles()

  // Merge active profile overrides into effective settings
  const effectiveSettings = useMemo(() => {
    const p = profiles.activeProfile
    if (!p) return settings
    const eff = {
      ...settings,
      ...(p.systemPrompt ? { systemPrompt: p.systemPrompt } : {}),
      ...(p.provider ? { provider: p.provider } : {}),
      ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
      ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
      ...(p.permissionLevel ? { permissionLevel: p.permissionLevel } : {}),
    }
    // Override the provider-specific model field when profile specifies a model
    if (p.model) {
      const prov = eff.provider
      if (prov === 'openai') eff.openaiModel = p.model
      else if (prov === 'anthropic') eff.anthropicModel = p.model
      else if (prov === 'gemini') eff.geminiModel = p.model
      else if (prov === 'openrouter') eff.openrouterModel = p.model
      else if (prov === 'modal') eff.modalModel = p.model
    }
    return eff
  }, [settings, profiles.activeProfile])

  // ─── Custom hooks ──────────────────────────────────────────────
  const providerConfig = useProviderConfig(effectiveSettings, selectedModel)
  const providerHealth = useProviderHealth(settings)
  const usageTracking = useUsageTracking()

  const voice = useVoice({
    language: settings.language,
    onToast: showToast,
  })

  const convManager = useConversations()

  const modalKeyPool = useModalKeyPool(settings)

  const toolExec = useToolExecution({
    settings: effectiveSettings,
    activeConvId: convManager.activeConvId,
    setConversations: convManager.setConversations,
    selectedModel,
    modalKeyPool,
  })

  const chat = useChat({
    settings: effectiveSettings,
    providerConfig,
    activeConvId: convManager.activeConvId,
    conversationsRef: convManager.conversationsRef,
    setConversations: convManager.setConversations,
    isAgentMode,
    executeTool: toolExec.executeTool,
    speakText: voice.speakText,
    showToast,
    onProviderSuccess: providerHealth.reportSuccess,
    onProviderError: (err) => {
      providerHealth.reportError(err)
      // Suggest a fallback when the current provider trips the "down"
      // threshold. We deliberately don't auto-switch (cost safety) — the
      // user clicks the toast action to change providers.
      const fallback = providerHealth.suggestFallback()
      if (fallback && fallback !== settings.provider) {
        showToast(
          `${settings.provider} indisponível — tentar ${fallback}? (Configurações → Provedores)`,
        )
      }
    },
    onUsage: (inputTokens, outputTokens) => usageTracking.recordUsage(effectiveSettings.provider, providerConfig.model, inputTokens, outputTokens),
  })

  const activeConv = convManager.activeConv
  // True only when the currently visible conversation is the one loading
  const isActiveConvLoading = chat.isLoading && chat.streamingConvId === convManager.activeConvId
  const tokenInfo = useTokenCounter(activeConv, providerConfig.model, input)

  useMemoryDreaming({
    enabled: settings.memoryEnabled,
    onToast: showToast,
  })

  // Forward ref for sendMessage — declared early so scheduledTasks can use it
  const sendMessageRef = useRef<(text: string) => void>(() => {})

  const scheduledTasks = useScheduledTasks({
    enabled: true,
    onTaskFire: (task) => {
      convManager.newConversation()
      // Send the scheduled prompt after a tick so the new conversation is active
      setTimeout(() => {
        sendMessageRef.current(task.prompt)
        showToast(`⏰ ${task.name}`)
      }, 100)
    },
  })

  // ─── Check for updates ─────────────────────────────────────────
  useEffect(() => {
    if (window.electron.checkForUpdates) {
      window.electron.checkForUpdates().then((res: any) => {
        if (res?.updateAvailable) setUpdateAvailable({ available: true, releaseUrl: res.releaseUrl, latestVersion: res.latestVersion })
      }).catch(console.error)
    }
  }, [])

  // ─── Load models ───────────────────────────────────────────────
  useEffect(() => {
    window.electron.listModels().then((data: any) => {
      if (data.models) {
        const names = data.models.map((m: any) => m.name)
        setModels(names)
        const saved = localStorage.getItem('openclaude-model')
        if (saved && names.includes(saved)) setSelectedModel(saved)
        else if (names.length > 0) { setSelectedModel(names[0]); localStorage.setItem('openclaude-model', names[0]) }
      }
    })
  }, [])

  // ─── Check Ollama status every 10s ─────────────────────────────
  useEffect(() => {
    const check = () => { window.electron.checkOllamaStatus().then(setOllamaOnline).catch(() => setOllamaOnline(false)) }
    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [])

  // ─── Smart scroll ──────────────────────────────────────────────
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 80
    }
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (isNearBottomRef.current) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeConv?.messages, chat.streamingText])

  // ─── Auto resize textarea ─────────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  // ─── Rotating placeholder ───────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setPlaceholderIdx(i => (i + 1) % PLACEHOLDER_HINTS.length), 8000)
    return () => clearInterval(interval)
  }, [])

  // ─── Theme management ──────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('openclaude-theme', theme)
  }, [theme])

  // ─── Code block copy buttons ──────────────────────────────────
  useEffect(() => {
    const handleCopyClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLButtonElement
      if (!btn) return
      const code = btn.closest('.code-block')?.querySelector('pre')?.innerText
      if (code) {
        navigator.clipboard.writeText(code)
        btn.textContent = 'Copiado!'
        setTimeout(() => { btn.textContent = 'Copiar' }, 2000)
      }
    }
    document.addEventListener('click', handleCopyClick)
    return () => document.removeEventListener('click', handleCopyClick)
  }, [])

  // ─── Keyboard shortcuts ────────────────────────────────────────
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        if (showModelDropdown) setShowModelDropdown(false)
      }
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); convManager.newConversation() }
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); setShowCommandPalette(v => !v) }
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); setShowSettings(true) }
      if (e.ctrlKey && e.shiftKey && e.key === 'V') { e.preventDefault(); setShowVision(true) }
      if (e.ctrlKey && e.key === 'p') { e.preventDefault(); setShowPersona(true) }
    }
    window.addEventListener('keydown', handleGlobalKeys)
    return () => window.removeEventListener('keydown', handleGlobalKeys)
  }, [showSettings, showModelDropdown])

  // ─── Drag & Drop ──────────────────────────────────────────────
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }
    const handleDragLeave = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDragOver(false)
      if (e.dataTransfer?.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i]
          const filePath = (file as any).path
          if (filePath) {
            try {
              const result = await window.electron.readDroppedFile(filePath)
              if (result.content) {
                setInput(prev => prev + `[Arquivo: ${result.name || filePath}]\n\`\`\`\n${result.content!.slice(0, 5000)}\n\`\`\`\n`)
              } else if (result.error) {
                setInput(prev => prev + `[Erro ao ler ${filePath}: ${result.error}]`)
              }
            } catch { setInput(prev => prev + `[Erro ao ler ${filePath}]`) }
          }
        }
      }
    }
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)
    return () => { document.removeEventListener('dragover', handleDragOver); document.removeEventListener('dragleave', handleDragLeave); document.removeEventListener('drop', handleDrop) }
  }, [])

  // ─── Actions ───────────────────────────────────────────────────
  const copyMessage = (content: string) => { navigator.clipboard.writeText(content); showToast('Mensagem copiada!') }

  const deleteMessage = (msgId: string) => {
    if (!convManager.activeConvId) return
    convManager.setConversations(prev => prev.map(c => {
      if (c.id !== convManager.activeConvId) return c
      return { ...c, messages: c.messages.filter(m => m.id !== msgId) }
    }))
  }

  // Keep sendMessageRef up to date with the latest chat.sendMessage
  sendMessageRef.current = chat.sendMessage

  const regenerateResponse = useCallback(() => {
    if (!activeConv || isActiveConvLoading) return
    const msgs = activeConv.messages
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx === -1) return
    const lastUserContent = msgs[lastUserIdx].content
    convManager.setConversations(prev => prev.map(c => {
      if (c.id !== convManager.activeConvId) return c
      return { ...c, messages: msgs.slice(0, lastUserIdx) }
    }))
    // Directly call sendMessage instead of fragile DOM querySelector
    setTimeout(() => sendMessageRef.current(lastUserContent), 50)
  }, [activeConv, isActiveConvLoading, convManager])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    sendMessageRef.current(input.trim())
    setInput('')
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleSecurityAudit = useCallback(() => {
    const findings = runSecurityAudit(settings)
    const icons = { danger: '🔴', warn: '🟡', info: '🔵' }
    for (const f of findings) {
      showToast(`${icons[f.severity]} ${f.title}: ${f.recommendation}`)
    }
  }, [settings, showToast])

  const displayModel = getDisplayModel(settings, selectedModel)

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className={`app-container ${settings.permissionLevel === 'ignore' ? 'ignore-mode-active' : ''}`}>
      {/* Toast notifications */}
      <Toasts toasts={toasts} onDismiss={dismissToast} />

      {/* First-run onboarding */}
      {showOnboarding && (
        <OnboardingModal
          onComplete={(updates) => {
            const newSettings = { ...settings, ...updates }
            setSettings(newSettings)
            localStorage.setItem('openclaude-settings', JSON.stringify(newSettings))
            setShowOnboarding(false)
            toastSuccess('Configuração concluída!')
          }}
          onDismiss={() => setShowOnboarding(false)}
        />
      )}

      {/* Drag overlay */}
      {dragOver && (
        <div className="drag-overlay">
          <FileText size={48} />
          <span>Solte o arquivo aqui</span>
        </div>
      )}

      {/* Settings modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={(s) => { setSettings(s); showToast('Configuracoes salvas!') }}
      />

      {/* Account & Sync */}
      {showAccount && (
        <Suspense fallback={null}>
          <AccountPanel
            isOpen={showAccount}
            onClose={() => setShowAccount(false)}
            language={settings.language}
            configured={auth.configured}
            session={auth.session}
            loading={auth.loading}
            passphrase={auth.passphrase}
            onSetPassphrase={auth.setPassphrase}
            onSignInEmail={auth.signInEmail}
            onSignUpEmail={auth.signUpEmail}
            onSignInGoogle={auth.signInGoogle}
            onSignOut={auth.signOut}
            prefs={sync.prefs}
            onPrefsChange={sync.setPrefs}
            syncState={sync.state}
            onPushNow={sync.pushNow}
            onPullNow={sync.pullNow}
          />
        </Suspense>
      )}

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        settings={settings}
        language={settings.language}
        onOpenVault={() => setShowVault(true)}
        onOpenPersona={() => setShowPersona(true)}
        onOpenArena={() => setShowArena(true)}
        onOpenCodeWorkspace={() => setShowCodeWorkspace(true)}
        onOpenVision={() => setShowVision(true)}
        onOpenRAG={() => setShowRAG(true)}
        onOpenWorkflow={() => setShowWorkflow(true)}
        onOpenParliament={() => setShowParliament(true)}
        onOpenOrion={() => setShowOrion(true)}
        onOpenAnalytics={() => setShowAnalytics(true)}
        onOpenImageUpload={() => document.getElementById('image-upload')?.click()}
        isAgentMode={isAgentMode}
        onToggleAgent={() => setIsAgentMode(v => !v)}
        activePersona={activePersona}
        ragEnabled={ragEnabled}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        isListening={voice.isListening}
        onToggleListening={() => voice.toggleListening(setInput)}
        ttsEnabled={voice.ttsEnabled}
        onToggleTTS={voice.toggleTTS}
        onSetPermission={(level) => setSettings({ ...settings, permissionLevel: level })}
        enabledFeatures={enabledFeatures}
        onOpenProfiles={() => setShowProfiles(true)}
        onOpenScheduler={() => setShowScheduler(true)}
        activeProfileName={profiles.activeProfile?.name}
        scheduledTaskCount={scheduledTasks.enabledCount}
        onSecurityAudit={handleSecurityAudit}
      />

      {/* ═══ Lazy-loaded feature panels — single Suspense boundary ═══
         Each panel is a separate JS chunk, loaded only when user opens it.
         Saves ~1MB from initial bundle. Fallback is minimal (modals load fast). */}
      <Suspense fallback={<div className="lazy-panel-fallback" role="status" aria-label="Carregando painel"><Loader2 size={20} className="spin" /></div>}>
        {showAnalytics && <AnalyticsDashboard isOpen={showAnalytics} onClose={() => setShowAnalytics(false)} language={settings.language} />}
        {showParliament && (
          <ParliamentMode settings={settings} ollamaModels={models} onClose={() => setShowParliament(false)}
            onInsertToChat={(text) => { setInput(prev => (prev ? prev + '\n\n' : '') + text); setShowParliament(false) }} />
        )}
        {showVault && (
          <PromptVault onClose={() => setShowVault(false)}
            onInsert={(text) => { setInput(prev => (prev ? prev + '\n\n' : '') + text); setShowVault(false) }} />
        )}
        {showPersona && (
          <PersonaEngine settings={settings} ollamaModels={models} activePersonaId={activePersonaId}
            onClose={() => setShowPersona(false)}
            onActivatePersona={(persona) => { setActivePersona(persona); setActivePersonaId(persona?.id ?? null) }} />
        )}
        {showArena && <ModelArena settings={settings} ollamaModels={models} onClose={() => setShowArena(false)} />}
        {showCodeWorkspace && (
          <CodeWorkspace settings={settings} ollamaModels={models} onClose={() => setShowCodeWorkspace(false)}
            onInsertToChat={(text) => { setInput(prev => (prev ? prev + '\n\n' : '') + text); setShowCodeWorkspace(false) }} />
        )}
        {showVision && (
          <VisionMode settings={settings} ollamaModels={models} onClose={() => setShowVision(false)}
            onInsertToChat={(text) => { setInput(prev => (prev ? prev + '\n\n' : '') + text); setShowVision(false) }} />
        )}
        {showRAG && <RAGPanel settings={settings} ollamaModels={models} onClose={() => setShowRAG(false)} ragEnabled={ragEnabled} onToggleRAG={setRagEnabled} />}
        {showWorkflow && (
          <WorkflowBuilder settings={settings} onClose={() => setShowWorkflow(false)}
            onInsertToChat={(text) => { setInput(prev => (prev ? prev + '\n\n' : '') + text); setShowWorkflow(false) }} />
        )}
        {showOrion && <ORION settings={settings} onClose={() => setShowOrion(false)} />}
        {showProfiles && (
          <ProfilesPanel
            isOpen={showProfiles}
            onClose={() => setShowProfiles(false)}
            allProfiles={profiles.allProfiles}
            activeProfileId={profiles.activeProfileId}
            onActivate={profiles.activate}
            onCreate={profiles.create}
            onUpdate={profiles.update}
            onRemove={profiles.remove}
            onDuplicate={profiles.duplicate}
            language={settings.language}
          />
        )}
        {showScheduler && (
          <ScheduledTasksPanel
            isOpen={showScheduler}
            onClose={() => setShowScheduler(false)}
            tasks={scheduledTasks.tasks}
            onCreate={scheduledTasks.create}
            onUpdate={scheduledTasks.update}
            onRemove={scheduledTasks.remove}
            onToggle={scheduledTasks.toggle}
            onRunNow={scheduledTasks.runNow}
            profiles={profiles.allProfiles}
            language={settings.language}
          />
        )}
      </Suspense>

      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-drag">
          <div className="titlebar-logo">
            <div className="oc-logo-small">OC</div>
            <span>OpenClaude Desktop</span>
          </div>
          <div className={`ollama-status ${ollamaOnline ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            <span className="status-text">{ollamaOnline ? 'Ollama Online' : 'Ollama Offline'}</span>
          </div>
          {settings.provider !== 'ollama' && (
            <div className={`provider-health provider-health-${providerHealth.currentHealth.status}`} title={providerHealth.currentHealth.lastError || ''}>
              <span className="status-dot" />
              <span className="status-text">{settings.provider} {providerHealth.currentHealth.status === 'healthy' ? '●' : providerHealth.currentHealth.status === 'degraded' ? '◐' : '○'}</span>
            </div>
          )}
        </div>
        <div className="titlebar-center">{activeConv ? activeConv.title : ''}</div>
        <div className="titlebar-actions">
          <button className="titlebar-action-btn" onClick={() => setSidebarOpen(p => !p)} title="Toggle sidebar">
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
          </button>
          <button className="titlebar-action-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Alternar tema">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          {activeConv && activeConv.messages.length > 0 && (
            <>
              <button className="titlebar-action-btn" onClick={regenerateResponse} title="Regenerar última resposta" disabled={isActiveConvLoading}>
                <RefreshCw size={14} />
              </button>
              <button className="titlebar-action-btn export-btn" onClick={() => convManager.exportConversation(showToast)} title="Exportar conversa">
                <Download size={14} /><span>Exportar</span>
              </button>
            </>
          )}
          <button className="titlebar-action-btn" onClick={() => setShowAnalytics(true)} title="Analytics & Insights"><BarChart3 size={14} /></button>
          <button
            className="titlebar-action-btn"
            onClick={() => setShowAccount(true)}
            title={auth.session ? `${auth.session.user.email} — Conta & Sincronização` : 'Conta & Sincronização'}
          >
            <User size={14} />
            {auth.session && <span className="account-dot" aria-hidden="true" />}
          </button>
          <button className="titlebar-action-btn" onClick={() => setShowSettings(true)} title="Configurações (Ctrl+,)"><SettingsIcon size={14} /></button>
        </div>
        <div className="titlebar-controls">
          <button onClick={() => window.electron.minimize()} className="ctrl-btn minimize"><Minus size={12}/></button>
          <button onClick={() => window.electron.maximize()} className="ctrl-btn maximize"><Square size={10}/></button>
          <button onClick={() => window.electron.close()} className="ctrl-btn close"><X size={12}/></button>
        </div>
      </div>

      {/* Update Banner */}
      {updateAvailable?.available && (
        <div className="update-banner">
          <ArrowUpCircle size={18} className="update-icon" />
          <span>Nova versão {updateAvailable.latestVersion} disponível!</span>
          <button className="update-download-btn" onClick={() => window.electron.openTarget(updateAvailable.releaseUrl)}>Baixar</button>
          <button className="update-close-btn" onClick={() => setUpdateAvailable(null)}>X</button>
        </div>
      )}

      <div className="main-layout">
        {/* Sidebar */}
        <div className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
          <div className="sidebar-header">
            <button className="new-chat-btn" onClick={convManager.newConversation}>
              <Plus size={16} /> Nova conversa
            </button>
            <div className="search-container">
              <Search size={14} className="search-icon" />
              <input ref={searchInputRef} type="text" value={convManager.searchQuery}
                onChange={e => convManager.setSearchQuery(e.target.value)}
                placeholder="Buscar conversas... (Ctrl+K)" className="search-input" />
            </div>
          </div>

          <div className="conversations-list">
            {convManager.loadingConversations ? (
              <>{[1,2,3,4,5].map(i => <div key={i} className="conv-item skeleton"><div className="skeleton-bar" /></div>)}</>
            ) : (
              convManager.filteredConversations.map(conv => (
                <div key={conv.id}
                  className={`conv-item ${conv.id === convManager.activeConvId ? 'active' : ''} ${convManager.pinnedConvs.has(conv.id) ? 'pinned' : ''}`}
                  onClick={() => convManager.setActiveConvId(conv.id)}>
                  {convManager.pinnedConvs.has(conv.id) ? <Pin size={14} className="conv-icon pinned-icon" /> : <MessageSquare size={14} className="conv-icon" />}
                  <div className="conv-info">
                    <span className="conv-title">{conv.title}</span>
                    <span className="conv-date">{getRelativeTime(conv.createdAt)}</span>
                  </div>
                  <div className="conv-actions">
                    <button className="conv-action-btn" onClick={(e) => { e.stopPropagation(); convManager.togglePin(conv.id) }} title={convManager.pinnedConvs.has(conv.id) ? 'Desafixar' : 'Fixar'}>
                      <Pin size={12} />
                    </button>
                    <button className="conv-action-btn conv-delete" onClick={(e) => { e.stopPropagation(); convManager.deleteConversation(conv.id) }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="sidebar-footer">
            <div className="model-selector">
              {settings.provider !== 'ollama' ? (
                <button className="model-btn" onClick={() => setShowSettings(true)}>
                  <Globe size={14} />
                  <span className="model-name" style={{ textTransform: 'capitalize' }}>{settings.provider}: {displayModel}</span>
                  <SettingsIcon size={12} />
                </button>
              ) : (
                <>
                  <button className="model-btn" onClick={() => setShowModelDropdown(!showModelDropdown)}>
                    <Bot size={14} />
                    <span className="model-name">{selectedModel}</span>
                    <ChevronDown size={12} />
                  </button>
                  {showModelDropdown && (
                    <div className="model-dropdown">
                      {models.map(m => (
                        <button key={m} className={`model-option ${m === selectedModel ? 'active' : ''}`}
                          onClick={() => { setSelectedModel(m); localStorage.setItem('openclaude-model', m); setShowModelDropdown(false) }}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Chat area */}
        <div className="chat-area">
          {settings.permissionLevel === 'ignore' && (
            <div className="ignore-warning-banner">
              <AlertCircle size={14} />
              <span>{settings.language === 'en' ? 'Bypass Mode Active: All tools will be auto-approved' : 'Modo Bypass Ativo: Ferramentas serão aprovadas automaticamente'}</span>
            </div>
          )}
          <div className="messages-container" ref={messagesContainerRef}>
            {!activeConv || activeConv.messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-logo-large">OC</div>
                <h2>Como posso ajudar?</h2>
                <p>Modelo atual: <strong>{displayModel}</strong> via <span style={{ textTransform: 'capitalize' }}>{settings.provider}</span></p>
                <div className="suggestions-grid">
                  {SUGGESTIONS.map(s => (
                    <button key={s.text} className="suggestion-card" onClick={() => { setInput(s.text); textareaRef.current?.focus() }}>
                      <s.icon size={18} className="sugg-icon" />
                      <span>{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeConv.messages.map(msg => (
                <div key={msg.id} className={`message message-${msg.role}`}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? <User size={16} /> : <div className="oc-logo">OC</div>}
                  </div>
                  <div className="message-content">
                    {msg.content && <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />}
                    {msg.toolCalls && msg.toolCalls.map((tc, i) => {
                      const toolKey = `${msg.id}-${i}`
                      const resultText = msg.toolResults?.[i]?.result || ''
                      const defaultCollapsed = resultText.length > 200
                      const isCollapsed = collapsedTools.has(toolKey) ? !defaultCollapsed : defaultCollapsed
                      const toggleCollapse = () => {
                        const newSet = new Set(collapsedTools)
                        if (newSet.has(toolKey)) newSet.delete(toolKey); else newSet.add(toolKey)
                        setCollapsedTools(newSet)
                      }
                      return (
                        <div key={i} className="tool-call">
                          <button className="tool-call-header" onClick={toggleCollapse}>
                            {isCollapsed ? <Play size={10} className="tool-play" /> : <ChevronDown size={14} />}
                            <Wrench size={12} className="tool-icon" /><span>{tc.name}</span>
                          </button>
                          {!isCollapsed && (
                            <>
                              <pre className="tool-call-args">{JSON.stringify(tc.arguments, null, 2)}</pre>
                              {msg.toolResults?.[i] && (
                                <div className="tool-result"><Terminal size={12} /><pre>{msg.toolResults[i].result}</pre></div>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                    <div className="message-footer">
                      <span className="message-timestamp">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <div className="message-actions">
                        {msg.content && <CopyButton text={msg.content} title="Copiar como Markdown" onCopied={() => showToast('Copiado como Markdown')} />}
                        <button className="msg-action-btn" onClick={() => deleteMessage(msg.id)} title="Excluir mensagem"><Trash size={12} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
            {/* Streaming text — only show in the conversation that is actively streaming */}
            {chat.isStreaming && chat.streamingText && isActiveConvLoading && (
              <div className="message message-assistant">
                <div className="message-avatar"><div className="oc-logo">OC</div></div>
                <div className="message-content">
                  <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(chat.streamingText) }} />
                  <span className="streaming-cursor" />
                </div>
              </div>
            )}
            {isActiveConvLoading && (
              <div className="message message-assistant">
                <div className="message-avatar"><div className={`oc-logo ${isAgentMode ? 'agent-active' : ''}`}>OC</div></div>
                <div className="message-content">
                  <div className="agent-status-container">
                    <div className="typing-indicator"><span></span><span></span><span></span></div>
                    {isAgentMode && (
                      <div className="agent-badge"><Zap size={10} className="pulse" /><span>Agente: Passo {chat.agentSteps}</span></div>
                    )}
                    <button className="stop-agent-btn" onClick={chat.stopAgent} title="Interromper Agente">
                      <BotOff size={14} /> Parar
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Task Plan Panel */}
          {activeConv?.taskPlan && (
            <div className={`task-plan-panel ${taskPlanCollapsed ? 'collapsed' : ''}`}>
              <div
                className="task-plan-header"
                onClick={() => setTaskPlanCollapsed(c => !c)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
                title={taskPlanCollapsed ? 'Expandir' : 'Minimizar'}
              >
                <ChevronDown
                  size={14}
                  style={{
                    transform: taskPlanCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s ease',
                    flexShrink: 0
                  }}
                />
                <ListChecks size={14} /><span>{activeConv.taskPlan.goal}</span>
                <span className="task-plan-progress">{activeConv.taskPlan.tasks.filter(t => t.status === 'done').length}/{activeConv.taskPlan.tasks.length}</span>
              </div>
              <div className="task-plan-list" aria-hidden={taskPlanCollapsed}>
                {activeConv.taskPlan.tasks.map(task => (
                  <div key={task.id} className={`task-plan-item task-${task.status}`}>
                    {task.status === 'done' ? <CheckCircle2 size={12} /> :
                     task.status === 'in_progress' ? <Loader2 size={12} className="spin" /> :
                     task.status === 'failed' ? <AlertCircle size={12} /> : <Circle size={12} />}
                    <span>{task.title}</span>
                    {task.result && <span className="task-result">{task.result}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool Approval Banner */}
          {toolExec.pendingApproval && (
            <div className="approval-banner">
              <div className="approval-header"><AlertCircle size={16} /><span>{settings.language === 'en' ? 'Permission required' : 'Permissão necessária'}</span></div>
              <div className="approval-detail">
                <span className="approval-tool">{toolExec.pendingApproval.toolName}</span>
                <pre className="approval-args">{JSON.stringify(toolExec.pendingApproval.args, null, 2)}</pre>
              </div>
              <div className="approval-actions">
                <button className="approval-btn approve" onClick={() => { toolExec.pendingApproval!.resolve(true); toolExec.setPendingApproval(null) }}>
                  <CheckCircle2 size={14} /> {settings.language === 'en' ? 'Allow' : 'Permitir'}
                </button>
                <button className="approval-btn deny" onClick={() => { toolExec.pendingApproval!.resolve(false); toolExec.setPendingApproval(null) }}>
                  <XCircle size={14} /> {settings.language === 'en' ? 'Deny' : 'Negar'}
                </button>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="input-area" onClick={() => showFeatureMenu && setShowFeatureMenu(false)}>
            <div className="input-wrapper">
              <input type="file" id="image-upload" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => { setInput(prev => prev + `\n[Imagem: ${file.name}]\n`); showToast(`Imagem ${file.name} anexada`) }
                reader.readAsDataURL(file)
                e.target.value = ''
              }} />

              {/* Status pills */}
              {(isAgentMode || settings.permissionLevel === 'ignore' || activePersona || ragEnabled || isActiveConvLoading || profiles.activeProfile) && (
                <div className="input-status-bar">
                  {isAgentMode && <span className="status-pill agent"><Zap size={9} />Agente{isActiveConvLoading ? ` · Passo ${chat.agentSteps}` : ''}</span>}
                  {settings.permissionLevel === 'ignore' && <span className="status-pill danger"><AlertCircle size={9} />Bypass Mode</span>}
                  {activePersona && <span className="status-pill persona"><UserCog size={9} />{activePersona.name}</span>}
                  {ragEnabled && <span className="status-pill rag"><Database size={9} />RAG</span>}
                  {profiles.activeProfile && <span className="status-pill profile">{profiles.activeProfile.icon} {profiles.activeProfile.name}</span>}
                  {isActiveConvLoading && <button className="status-pill stop-pill" onClick={chat.stopAgent}><Square size={9} />Parar</button>}
                </div>
              )}

              <div className="input-pill" onClick={e => e.stopPropagation()}>
                <div className="input-left-actions">
                  <button className="input-icon-btn" onClick={() => setShowCommandPalette(true)} title="Ferramentas e recursos (Ctrl+K)"><Plus size={18} /></button>
                </div>
                <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={PLACEHOLDER_HINTS[placeholderIdx]} className="message-input" rows={1} disabled={isActiveConvLoading} />
                <div className="input-right-actions">
                  {input.length > 0 && <button className="input-icon-btn" onClick={() => { setInput(''); textareaRef.current?.focus() }} title="Limpar"><XCircle size={14} /></button>}
                  <button className={`mode-toggle ${isAgentMode ? 'agent-on' : ''}`} onClick={() => setIsAgentMode(!isAgentMode)}
                    title={isAgentMode ? 'Chat normal' : 'Modo Agente autônomo'}>
                    <Zap size={13} /><span>{isAgentMode ? 'Agente' : 'Chat'}</span>
                  </button>
                  {isActiveConvLoading ? (
                    <button className="send-circle stop" onClick={chat.stopAgent} title="Parar"><Square size={14} fill="currentColor" /></button>
                  ) : (
                    <button className={`send-circle ${!input.trim() ? 'disabled' : ''}`} onClick={handleSend} disabled={!input.trim()} title="Enviar (Enter)">
                      <Send size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="input-footer">
                <p className="input-hint">Enter para enviar · Shift+Enter nova linha · Ctrl+N nova conversa · Ctrl+, config</p>
                <div className="input-footer-right">
                  {settings.provider !== 'ollama' && usageTracking.getTodayCost() > 0 && (
                    <span className="cost-counter">{usageTracking.formatCost(usageTracking.getTodayCost())} hoje</span>
                  )}
                  <span className={`token-counter ${tokenInfo.critical ? 'critical' : tokenInfo.warning ? 'warning' : ''}`}>
                    {formatTokenCount(tokenInfo.used)}/{formatTokenCount(tokenInfo.limit)} ({tokenInfo.percentage}%)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
