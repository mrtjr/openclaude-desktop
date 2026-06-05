import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react'
import 'highlight.js/styles/github-dark.css'
import { Send, Plus, Trash2, Minus, Square, X, Bot, User, Loader2, ChevronDown, Wrench, Terminal, Search, Settings as SettingsIcon, Download, FileText, XCircle, MessageSquare, Play, Code, Globe, ArrowUpCircle, Zap, BotOff, RefreshCw, Pin, PanelLeftClose, PanelLeft, Sun, Moon, Contrast, Palette, Image, Trash, Mic, ListChecks, CheckCircle2, Circle, AlertCircle, Clock, BarChart3, Database, UserCog, Activity, GitBranch } from 'lucide-react'
import { loadSettings, type AppSettings } from './settingsConfig'
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
const AgentDashboard = lazy(() => import('./AgentDashboard'))
const ShortcutCheatSheet = lazy(() => import('./components/ShortcutCheatSheet'))
// Settings is a heavy modal (provider panes) shown on demand — lazy so it
// stays out of the boot bundle. loadSettings comes from settingsConfig (light).
const SettingsModal = lazy(() => import('./Settings'))

// ─── Extracted modules ──────────────────────────────────────────────
import type { Message } from './types'
import { PLACEHOLDER_HINTS, SUGGESTIONS } from './constants/prompts'
import { formatMarkdown, getRelativeTime, groupByBucket, bucketLabel } from './utils/formatting'

// ─── Custom hooks ───────────────────────────────────────────────────
import { useProviderConfig, getDisplayModel } from './hooks/useProviderConfig'
import { useVoice } from './hooks/useVoice'
import { useConversations } from './hooks/useConversations'
import { useToolExecution } from './hooks/useToolExecution'
import { useModalKeyPool } from './hooks/useModalKeyPool'
import { useChat } from './hooks/useChat'
import { useConversationFork } from './hooks/useConversationFork'
import { useProviderHealth } from './hooks/useProviderHealth'
import { useTokenCounter, formatTokenCount } from './hooks/useTokenCounter'
import { useAccentColor } from './hooks/useAccentColor'
import { AccentPicker } from './components/AccentPicker'
import { parseSlashInput } from './utils/slashCommands'
import { RegenSplit } from './components/RegenSplit'
import { AmbientOrb } from './components/AmbientOrb'
import { SlashPopover } from './components/SlashPopover'
import UserMenu from './components/UserMenu'
import PermissionModeButton from './components/PermissionModeButton'
import ContextWindowPanel from './components/ContextWindowPanel'
import { useContextBreakdown } from './hooks/useContextBreakdown'
import { useMathReady } from './hooks/useMathReady'
import { useTokenizerReady } from './hooks/useTokenizerReady'
import { partitionTools, decideDeferral } from './services/toolDeferral'
import { TOOLS } from './constants/tools'
import { getModelContextLimit, countToolSchemas } from './services/contextEngine'
import { useUsageTracking } from './hooks/useUsageTracking'
import { loadEnabledFeatures, saveEnabledFeatures, isFeatureEnabled } from './config/features'
import { useMemoryDreaming } from './hooks/useMemoryDreaming'
import { useProfiles } from './hooks/useProfiles'
import { useScheduledTasks } from './hooks/useScheduledTasks'
import { runSecurityAudit } from './utils/securityAudit'
import { useToast } from './hooks/useToast'
import { useAuth } from './hooks/useAuth'
import { useSync } from './hooks/useSync'
import { useDevInsights } from './hooks/useDevInsights'
import { logInsight } from './services/devInsights'

// ─── App ─────────────────────────────────────────────────────────────
export default function App() {
  // Upgrade raw `$…$` to typeset math once KaTeX finishes lazy-loading.
  useMathReady()
  // Lazy-load the real BPE tokenizer after first paint; token counts and
  // the context-assembly budget sharpen from char/4 to exact once ready.
  useTokenizerReady()
  const [input, setInput] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('openclaude-model') || 'qwen35-uncensored')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [ollamaOnline, setOllamaOnline] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set())
  const [taskPlanCollapsed, setTaskPlanCollapsed] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<{available: boolean, releaseUrl: string, latestVersion: string} | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light' | 'oled'>(() => {
    // Priority: explicit user choice > OS preference > dark default.
    // OLED is opt-in only (never auto) — it's a power-user preference
    // for AMOLED hardware, not a sensible default.
    const saved = localStorage.getItem('openclaude-theme')
    if (saved === 'dark' || saved === 'light' || saved === 'oled') return saved
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return 'light'
    }
    return 'dark'
  })
  // Three-state cycle: dark → light → oled → dark.
  // OLED sits at the end so users must pass through light first —
  // discourages accidental activation and keeps the common 2-state
  // flow (dark↔light) reachable with two clicks from any state.
  const cycleTheme = () => setTheme(t => t === 'dark' ? 'light' : t === 'light' ? 'oled' : 'dark')
  const themeIcon = theme === 'dark' ? <Sun size={14} /> : theme === 'light' ? <Moon size={14} /> : <Contrast size={14} />
  const themeLabel = theme === 'dark' ? 'Tema: escuro (clique para claro)' : theme === 'light' ? 'Tema: claro (clique para OLED)' : 'Tema: OLED (clique para escuro)'
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
  const [showAgentDashboard, setShowAgentDashboard] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuAnchorRef = useRef<HTMLButtonElement>(null)
  const [showContextPanel, setShowContextPanel] = useState(false)
  const contextPanelAnchorRef = useRef<HTMLButtonElement>(null)
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean>>(loadEnabledFeatures)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isNearBottomRef = useRef(true)

  const { toasts, show: showToast, dismiss: dismissToast, success: toastSuccess, error: toastError } = useToast()
  // Suppress unused warnings — helpers available for future callers
  void toastSuccess; void toastError

  // ─── Accounts & Cloud Sync (v2.7.0, snapshot completo em v2.9.2) ─────
  // AccountPanel expõe 5 toggles (settings / apiKeys / profiles /
  // personas / scheduledTasks). Antes o snapshotProvider só preenchia os
  // 2 primeiros — os outros 3 toggles ficavam decorativos: nada era
  // enviado, nada era aplicado. Agora usamos refs atualizadas adiante
  // (profilesRef, scheduledTasksRef) e um IPC call para personas.
  const auth = useAuth()
  const profilesRef = useRef<any>(null)
  const scheduledTasksRef = useRef<any>(null)
  const sync = useSync({
    session: auth.session,
    passphrase: auth.passphrase,
    snapshotProvider: async () => {
      const snap: any = {
        settings: {
          theme, language: settings.language, provider: settings.provider,
        },
        apiKeys: {
          openai: settings.openaiApiKey || '',
          anthropic: settings.anthropicApiKey || '',
          gemini: settings.geminiApiKey || '',
          openrouter: settings.openrouterApiKey || '',
          modal: settings.modalApiKey || '',
          customApiKey: (settings as any).customApiKey || '',
        },
      }
      if (profilesRef.current?.customProfiles) {
        // only custom profiles sync — built-ins are identical everywhere
        snap.profiles = profilesRef.current.customProfiles
      }
      if (scheduledTasksRef.current?.tasks) {
        snap.scheduledTasks = scheduledTasksRef.current.tasks
      }
      try {
        const personasRes = await window.electron.personaLoad?.()
        if (personasRes?.personas) snap.personas = personasRes.personas
      } catch (e) { console.warn('[sync] persona snapshot load failed:', e) }
      return snap
    },
    applySnapshot: async (snap) => {
      if (snap.settings) {
        const remote = snap.settings.data || {}
        if (remote.theme && (remote.theme === 'dark' || remote.theme === 'light' || remote.theme === 'oled')) setTheme(remote.theme)
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
      if (snap.profiles?.data && Array.isArray(snap.profiles.data)) {
        profilesRef.current?.replaceAll?.(snap.profiles.data)
      }
      if (snap.scheduledTasks?.data && Array.isArray(snap.scheduledTasks.data)) {
        scheduledTasksRef.current?.replaceAll?.(snap.scheduledTasks.data)
      }
      if (snap.personas?.data && Array.isArray(snap.personas.data)) {
        try { await window.electron.personaSave?.(snap.personas.data) }
        catch (e) { console.warn('[sync] persona apply failed:', e) }
      }
    },
  })

  // ─── First-run onboarding ─────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('oc.onboarded')
  })

  // ─── Agent Profiles ────────────────────────────────────────────
  const profiles = useProfiles()
  // Keep the sync ref pointing at the latest hook object so snapshotProvider
  // (which runs later, from useSync's closure) reads current state.
  profilesRef.current = profiles

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
  // Accent color — writes --accent tokens into :root on mount + changes.
  const accent = useAccentColor()
  const [showAccentPicker, setShowAccentPicker] = useState(false)
  // Slash-command popover state. `slashIdx` is the selected suggestion
  // while the popover is open. Reset on input changes that no longer
  // look like a command.
  const [slashIdx, setSlashIdx] = useState(0)
  const [showRegenMenu, setShowRegenMenu] = useState(false)
  const usageTracking = useUsageTracking()

  const voice = useVoice({
    language: settings.language,
    onToast: showToast,
  })

  const convManager = useConversations()
  // useConversationFork has its own local Message shape that omits id/timestamp;
  // our app's Message is stricter. The fork logic only reads role/content/
  // arbitrary fields via spread, so the mismatch is cosmetic — cast away.
  const { forkFrom } = useConversationFork({
    conversationsRef: convManager.conversationsRef as any,
    setConversations: convManager.setConversations as any,
    setActiveConvId: convManager.setActiveConvId,
  })

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
      // toast has an explicit action button the user clicks to confirm.
      const fallback = providerHealth.suggestFallback()
      if (fallback && fallback !== settings.provider) {
        showToast({
          message: `${settings.provider} indisponível — trocar para ${fallback}?`,
          severity: 'warn',
          duration: 10000,
          action: {
            label: `Trocar para ${fallback}`,
            onClick: () => {
              const next = { ...settings, provider: fallback as any } as AppSettings
              setSettings(next)
              localStorage.setItem('openclaude-settings', JSON.stringify(next))
              showToast({ message: `Provedor ativo: ${fallback}`, severity: 'success' })
            },
          },
        })
      }
    },
    onUsage: (inputTokens, outputTokens) => usageTracking.recordUsage(effectiveSettings.provider, providerConfig.model, inputTokens, outputTokens),
  })

  const activeConv = convManager.activeConv
  // True only when the currently visible conversation is the one loading
  const isActiveConvLoading = chat.isLoading && chat.streamingConvId === convManager.activeConvId
  const tokenInfo = useTokenCounter(activeConv, providerConfig.model, input)

  // ─── Context breakdown (Claude-style /context panel, v2.12.6) ───
  // Memoized partition of TOOLS into eager + deferred based on the
  // user's setting. Passed to the chat pipeline so the request body
  // only carries the eager subset; deferredToolNames are rendered
  // into the system prompt as a compact manifest.
  const toolPartition = useMemo(() =>
    partitionTools(TOOLS as any, decideDeferral(
      settings.toolDeferralMode, getModelContextLimit(selectedModel), countToolSchemas(TOOLS as any),
    ).enabled),
    [settings.toolDeferralMode, selectedModel])
  const memoryText = useMemo(() => {
    const parts: string[] = []
    if (activeConv?.contextSummary) parts.push(activeConv.contextSummary)
    return parts.join('\n\n')
  }, [activeConv?.contextSummary])
  const ctxBreakdown = useContextBreakdown({
    activeConv,
    model: providerConfig.model,
    inputText: input,
    systemPrompt: settings.systemPrompt || '',
    memoryText,
    eagerTools: toolPartition.eager,
    deferredToolNames: toolPartition.deferredNames,
    deferredToolSchemas: (TOOLS as any[]).filter((t: any) => toolPartition.deferredNames.some(d => d.name === t.function.name)) as any,
    skillHeaders: activePersona ? `${activePersona.name}: ${activePersona.description || ''}` : '',
  })

  useMemoryDreaming({
    enabled: settings.memoryEnabled,
    onToast: showToast,
  })

  // ─── Dev Insights (privacy-safe usage telemetry) ───────────────
  // Owns the flush lifecycle; gated by the existing analytics opt-out.
  useDevInsights(settings.analyticsEnabled !== false)
  // Record which feature panels actually get used (event + name only, no
  // content), so improvement cycles can be prioritised from real usage.
  const prevFeatureOpen = useRef<Record<string, boolean>>({})
  useEffect(() => {
    const flags: Array<[string, boolean]> = [
      ['settings', showSettings], ['analytics', showAnalytics], ['parliament', showParliament],
      ['promptVault', showVault], ['persona', showPersona], ['modelArena', showArena],
      ['rag', showRAG], ['workflow', showWorkflow], ['orion', showOrion], ['vision', showVision],
      ['codeWorkspace', showCodeWorkspace], ['profiles', showProfiles], ['scheduler', showScheduler],
      ['agentDashboard', showAgentDashboard],
    ]
    for (const [name, open] of flags) {
      if (open && !prevFeatureOpen.current[name]) logInsight('feature', 'open', { feature: name })
      prevFeatureOpen.current[name] = open
    }
  }, [showSettings, showAnalytics, showParliament, showVault, showPersona, showArena, showRAG, showWorkflow, showOrion, showVision, showCodeWorkspace, showProfiles, showScheduler, showAgentDashboard])

  // Forward ref for sendMessage — declared early so scheduledTasks can use it
  const sendMessageRef = useRef<(text: string, convId?: string) => void>(() => {})

  const scheduledTasks = useScheduledTasks({
    enabled: true,
    onTaskFire: (task) => {
      // Capture the new conv id up-front — otherwise a batch of tasks
      // firing on the same tick would all pile into the LAST new
      // conversation (activeConvId only holds the most recent). Passing
      // the id explicitly through sendMessage routes each prompt to its
      // own fresh conversation.
      const newConvId = convManager.newConversation()
      setTimeout(() => {
        sendMessageRef.current(task.prompt, newConvId)
        showToast(`⏰ ${task.name}`)
      }, 150)
    },
  })
  scheduledTasksRef.current = scheduledTasks

  // ─── v2.12.0: Native notification on response complete ──────────
  // Fires exactly on the loading → done edge, and only when the window
  // is blurred (otherwise the user already sees the response). Opt-out
  // via settings.notifyOnComplete.
  const wasLoadingRef = useRef(false)
  useEffect(() => {
    const wasLoading = wasLoadingRef.current
    wasLoadingRef.current = isActiveConvLoading
    if (!wasLoading || isActiveConvLoading) return
    if (settings.notifyOnComplete === false) return
    if (!window.electron.showNotification || !window.electron.isWindowFocused) return
    window.electron.isWindowFocused().then(r => {
      if (r.focused) return  // don't nag a user who is already looking
      const title = settings.language === 'en' ? 'OpenClaude' : 'OpenClaude'
      const body = activeConv?.title
        ? (settings.language === 'en' ? `Response ready — ${activeConv.title}` : `Resposta pronta — ${activeConv.title}`)
        : (settings.language === 'en' ? 'Response ready' : 'Resposta pronta')
      window.electron.showNotification!({ title, body, silent: false })
    }).catch(() => {})
  }, [isActiveConvLoading, settings.notifyOnComplete, settings.language, activeConv?.title])

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
  // Dynamic overlay stack: Esc closes whichever is on top (last-opened first).
  // Each overlay registers its (open, close) pair; order matters — command
  // palette and small dropdowns come last so they close before big panels.
  useEffect(() => {
    const overlays: Array<[boolean, () => void]> = [
      [showModelDropdown, () => setShowModelDropdown(false)],
      [showFeatureMenu, () => setShowFeatureMenu(false)],
      [showCommandPalette, () => setShowCommandPalette(false)],
      [showAccentPicker, () => setShowAccentPicker(false)],
      [showRegenMenu, () => setShowRegenMenu(false)],
      [showSettings, () => setShowSettings(false)],
      [showAnalytics, () => setShowAnalytics(false)],
      [showProfiles, () => setShowProfiles(false)],
      [showScheduler, () => setShowScheduler(false)],
      [showVault, () => setShowVault(false)],
      [showPersona, () => setShowPersona(false)],
      [showArena, () => setShowArena(false)],
      [showRAG, () => setShowRAG(false)],
      [showWorkflow, () => setShowWorkflow(false)],
      [showOrion, () => setShowOrion(false)],
      [showVision, () => setShowVision(false)],
      [showCodeWorkspace, () => setShowCodeWorkspace(false)],
      [showParliament, () => setShowParliament(false)],
      [showAgentDashboard, () => setShowAgentDashboard(false)],
      [showShortcuts, () => setShowShortcuts(false)],
    ]

    const handleGlobalKeys = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const target = e.target as HTMLElement | null
      const inTextField =
        !!target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        )

      // Esc: close topmost overlay (dropdowns first, then modals).
      if (e.key === 'Escape') {
        for (const [open, close] of overlays) {
          if (open) { close(); return }
        }
      }

      // `/` focuses chat composer when not already typing (Discord/GitHub pattern)
      if (e.key === '/' && !inTextField && !mod) {
        const ta = document.querySelector<HTMLTextAreaElement>('.message-input')
        if (ta) { e.preventDefault(); ta.focus() }
        return
      }

      if (mod && e.key === 'n') { e.preventDefault(); convManager.newConversation() }
      else if (mod && e.key === 'k') { e.preventDefault(); setShowCommandPalette(v => !v) }
      else if (mod && e.key === ',') { e.preventDefault(); setShowSettings(true) }
      else if (mod && e.shiftKey && e.key === 'V') { e.preventDefault(); setShowVision(true) }
      else if (mod && e.key === 'p' && !e.shiftKey) { e.preventDefault(); setShowPersona(true) }
      // Toggle sidebar: Ctrl/Cmd+\ (VS Code convention; avoids clobbering / focus)
      else if (mod && e.key === '\\') { e.preventDefault(); setSidebarOpen(v => !v) }
      // Ctrl/Cmd+Shift+D: open Agent Dashboard (unified ops view)
      else if (mod && e.shiftKey && e.key === 'D') { e.preventDefault(); setShowAgentDashboard(true) }
      // `?` opens the shortcut cheat sheet (when not in text field)
      else if (e.key === '?' && !inTextField && !mod) { e.preventDefault(); setShowShortcuts(true) }
    }
    window.addEventListener('keydown', handleGlobalKeys)
    return () => window.removeEventListener('keydown', handleGlobalKeys)
  }, [
    showSettings, showModelDropdown, showFeatureMenu, showCommandPalette,
    showAccentPicker, showRegenMenu,
    showAnalytics, showProfiles, showScheduler, showVault,
    showPersona, showArena, showRAG, showWorkflow, showOrion, showVision,
    showCodeWorkspace, showParliament, showAgentDashboard, showShortcuts, convManager,
  ])

  // ─── Drag & Drop ──────────────────────────────────────────────
  useEffect(() => {
    // Drag counter — the browser fires dragleave every time the cursor
    // crosses a child element boundary, which would otherwise make the
    // overlay flicker. By counting enter/leave pairs we only hide the
    // overlay when the drag has truly left the window.
    let dragDepth = 0
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation()
      dragDepth++
      if (dragDepth === 1) setDragOver(true)
    }
    const handleDragOver  = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation()
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) setDragOver(false)
    }
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation()
      dragDepth = 0; setDragOver(false)
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
    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
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

  const regenerateResponse = useCallback((modelOverride?: string) => {
    if (!activeConv || isActiveConvLoading) return
    // Grab last user content from the current snapshot for the resend call,
    // but recompute the slice index inside the updater against the *fresh*
    // prev state — otherwise rapid regen clicks or in-flight streams leave
    // us slicing against a stale message array and dropping live messages.
    const snapshot = activeConv.messages
    let snapLastUserIdx = -1
    for (let i = snapshot.length - 1; i >= 0; i--) {
      if (snapshot[i].role === 'user') { snapLastUserIdx = i; break }
    }
    if (snapLastUserIdx === -1) return
    const lastUserContent = snapshot[snapLastUserIdx].content
    convManager.setConversations(prev => prev.map(c => {
      if (c.id !== convManager.activeConvId) return c
      let idx = -1
      for (let i = c.messages.length - 1; i >= 0; i--) {
        if (c.messages[i].role === 'user') { idx = i; break }
      }
      if (idx === -1) return c
      return { ...c, messages: c.messages.slice(0, idx) }
    }))
    // Model override: apply before send. Timeout lets the state update
    // flush so useChat sees the new providerConfig on the next tick.
    if (modelOverride) {
      const prov = settings.provider
      if (prov === 'ollama') {
        setSelectedModel(modelOverride)
        localStorage.setItem('openclaude-model', modelOverride)
      } else {
        const key = prov === 'openai' ? 'openaiModel'
          : prov === 'anthropic' ? 'anthropicModel'
          : prov === 'gemini' ? 'geminiModel'
          : prov === 'openrouter' ? 'openrouterModel'
          : prov === 'modal' ? 'modalModel'
          : null
        if (key) {
          const next = { ...settings, [key]: modelOverride } as typeof settings
          setSettings(next); localStorage.setItem('openclaude-settings', JSON.stringify(next))
        }
      }
    }
    // Directly call sendMessage instead of fragile DOM querySelector
    setTimeout(() => sendMessageRef.current(lastUserContent), 80)
  }, [activeConv, isActiveConvLoading, convManager, settings])

  // Slash command parse + execute. Memoised so the popover render
  // doesn't re-walk SLASH_COMMANDS on every unrelated state change.
  const slash = useMemo(() => parseSlashInput(input), [input])
  useEffect(() => { setSlashIdx(0) }, [slash?.name])

  const executeSlash = useCallback((cmdName: string, arg: string) => {
    const lang = settings.language
    const clean = arg.trim()
    switch (cmdName) {
      case 'clear':
        convManager.newConversation()
        setInput('')
        break
      case 'model':
        if (clean) {
          // Best-effort: if arg matches a known ollama/local model id,
          // apply directly; otherwise open the dropdown filtered.
          const match = models.find(m => m.toLowerCase() === clean.toLowerCase())
            || models.find(m => m.toLowerCase().includes(clean.toLowerCase()))
          if (match) {
            setSettings(s => ({ ...s, ollamaModel: match }))
            showToast(lang === 'en' ? `Model set to ${match}` : `Modelo: ${match}`, 'success')
          } else {
            setShowModelDropdown(true)
            showToast(lang === 'en' ? `No model matched "${clean}"` : `Nenhum modelo "${clean}"`, 'info')
          }
        } else {
          setShowModelDropdown(true)
        }
        setInput('')
        break
      case 'system':
        if (clean) {
          const next = { ...settings, systemPrompt: clean }
          setSettings(next); localStorage.setItem('openclaude-settings', JSON.stringify(next))
          showToast(lang === 'en' ? 'System prompt updated' : 'System prompt atualizado', 'success')
        } else {
          setShowSettings(true)
        }
        setInput('')
        break
      case 'regen':
        regenerateResponse()
        setInput('')
        break
      case 'theme':
        if (clean === 'dark' || clean === 'light' || clean === 'oled') {
          setTheme(clean)
        } else {
          cycleTheme()
        }
        setInput('')
        break
      case 'context':
        setShowContextPanel(true)
        setInput('')
        break
      case 'compact':
        // Manual compact: if conv has history, send the current history
        // through the existing compactContext IPC and store the summary.
        (async () => {
          const conv = activeConv
          if (!conv || conv.messages.length < 2) {
            showToast(lang === 'en' ? 'Nothing to compact yet' : 'Nada para compactar ainda', 'info')
            return
          }
          try {
            const res = await window.electron.compactContext({
              messages: conv.messages as any,
              model: providerConfig.model,
              language: lang,
              provider: settings.provider,
              ...(clean ? { instructions: clean } : {}),
            } as any)
            if (res?.summary) {
              const prev = conv.contextSummary || ''
              const merged = (prev ? prev + '\n\n' : '') + res.summary
              const trimmed = merged.length > 2000 ? merged.slice(-2000) : merged
              convManager.setConversations(list => list.map(c =>
                c.id !== conv.id ? c : { ...c, contextSummary: trimmed }
              ))
              showToast(lang === 'en' ? 'Context compacted' : 'Contexto compactado', 'success')
            } else {
              showToast(lang === 'en' ? 'Compact returned no summary' : 'Compactação sem resumo', 'info')
            }
          } catch (e) {
            console.warn('[slash/compact] failed:', e)
            showToast(lang === 'en' ? 'Compact failed' : 'Falha ao compactar', 'error')
          }
        })()
        setInput('')
        break
      default:
        // Unknown — fall through to normal send.
        sendMessageRef.current(input.trim())
        setInput('')
    }
  }, [convManager, models, settings, regenerateResponse, showToast, input, cycleTheme, activeConv, providerConfig.model])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    // If the input is a complete, unambiguous slash command, route it
    // through the executor instead of sending to the model.
    if (slash && slash.matches.length > 0) {
      const exact = slash.matches.find(m => m.name === slash.name) || slash.matches[slashIdx] || slash.matches[0]
      executeSlash(exact.name, slash.arg)
      return
    }
    // Escape hatch: leading "//" sends literal "/..." without the escape.
    const payload = input.startsWith('//') ? input.slice(1) : input
    sendMessageRef.current(payload.trim())
    setInput('')
  }, [input, slash, slashIdx, executeSlash])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash popover: capture navigation keys before sending.
    if (slash && slash.matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % slash.matches.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIdx(i => (i - 1 + slash.matches.length) % slash.matches.length); return }
      if (e.key === 'Tab') {
        // Tab completes the name (adds a trailing space so user can type args).
        e.preventDefault()
        const pick = slash.matches[slashIdx] || slash.matches[0]
        setInput('/' + pick.name + ' ')
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setInput(''); return }
    }
    // Enter sends; Shift+Enter inserts newline. Ctrl/Cmd+Enter also sends
    // (ChatGPT/Claude.ai muscle memory — some users disable plain Enter via
    // IME or accessibility tools and rely on the modifier variant).
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend() }
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

      {/* Settings modal — lazy; only mounted when open so its chunk loads on demand */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            settings={settings}
            onSave={(s) => { setSettings(s); showToast('Configuracoes salvas!') }}
          />
        </Suspense>
      )}

      {/* Command Palette (Ctrl+K) */}
      <AccentPicker
        isOpen={showAccentPicker}
        onClose={() => setShowAccentPicker(false)}
        value={accent.value}
        currentHex={accent.currentHex}
        isCustom={accent.isCustom}
        onPreset={accent.setPreset}
        onCustomHex={accent.setCustomHex}
        onReset={accent.reset}
        language={settings.language}
      />
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
        onToggleTheme={cycleTheme}
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
        onNewChat={() => convManager.newConversation()}
        onOpenAgentDashboard={() => setShowAgentDashboard(true)}
        onExportConversation={() => convManager.exportConversation(showToast)}
        onClearConversation={() => {
          if (!activeConv) return
          convManager.setConversations(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [] } : c))
          showToast(settings.language === 'en' ? 'Conversation cleared' : 'Conversa limpa')
        }}
        onOpenSettings={() => setShowSettings(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
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
        {showAgentDashboard && (
          <AgentDashboard
            isOpen={showAgentDashboard}
            onClose={() => setShowAgentDashboard(false)}
            settings={settings}
            language={settings.language}
            activePersona={activePersona}
            onOpenPersonas={() => { setShowAgentDashboard(false); setShowPersona(true) }}
            scheduledTasks={scheduledTasks.tasks}
            onOpenScheduler={() => { setShowAgentDashboard(false); setShowScheduler(true) }}
            onRunTaskNow={scheduledTasks.runNow}
            onToggleTask={scheduledTasks.toggle}
            todayCost={usageTracking.getTodayCost()}
            monthCost={usageTracking.getSummary(30).totalCost}
            monthEntries={usageTracking.getSummary(30).entries.length}
            healthMap={providerHealth.healthMap}
            configuredProviders={providerHealth.getConfiguredProviders()}
            onOpenSettings={() => { setShowAgentDashboard(false); setShowSettings(true) }}
            isAgentMode={isAgentMode}
            onToggleAgentMode={() => setIsAgentMode(v => !v)}
            onOpenWorkflows={() => { setShowAgentDashboard(false); setShowWorkflow(true) }}
            onOpenAnalytics={() => { setShowAgentDashboard(false); setShowAnalytics(true) }}
          />
        )}
        {showShortcuts && (
          <ShortcutCheatSheet
            isOpen={showShortcuts}
            onClose={() => setShowShortcuts(false)}
            language={settings.language}
          />
        )}
      </Suspense>

      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-drag">
          <div className="titlebar-logo">
            <div className="titlebar-logo-mark">OC</div>
            <span className="titlebar-logo-text">OpenClaude</span>
          </div>
          <div className="titlebar-badges">
            <div
              className={`status-pill ${ollamaOnline ? 'ok' : 'err'}`}
              title={ollamaOnline ? 'Ollama local está respondendo' : 'Ollama local offline — instale/inicie em ollama.ai'}
            >
              <span className="status-dot" />
              <span className="status-text">Ollama</span>
            </div>
            {settings.provider !== 'ollama' && (
              <div
                className={`status-pill ${providerHealth.currentHealth.status === 'healthy' ? 'ok' : providerHealth.currentHealth.status === 'degraded' ? 'warn' : 'err'}`}
                title={providerHealth.currentHealth.lastError || `${settings.provider}: ${providerHealth.currentHealth.status}`}
              >
                <span className="status-dot" />
                <span className="status-text">{settings.provider}</span>
              </div>
            )}
          </div>
        </div>
        {activeConv && activeConv.title && (
          <div className="titlebar-center" title={activeConv.title}>{activeConv.title}</div>
        )}
        {/* Titlebar só com sidebar toggle + ações específicas da
            conversa (Regen/Export) + Analytics. Tudo ligado a
            preferência do usuário (tema, accent, idioma, perfil,
            configurações, dashboard do agente) migrou para o
            UserMenu ancorado na sidebar — evita duplicação. */}
        <div className="titlebar-actions">
          <button className="titlebar-action-btn" onClick={() => setSidebarOpen(p => !p)} title="Toggle sidebar">
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
          </button>
          {activeConv && activeConv.messages.length > 0 && (
            <>
              <RegenSplit
                isLoading={isActiveConvLoading}
                settings={settings}
                selectedModel={selectedModel}
                ollamaModels={models}
                onRegenerate={regenerateResponse}
                open={showRegenMenu}
                onOpenChange={setShowRegenMenu}
              />
              <button className="titlebar-action-btn export-btn" onClick={() => convManager.exportConversation(showToast)} title="Exportar conversa">
                <Download size={14} /><span>Exportar</span>
              </button>
            </>
          )}
          <button className="titlebar-action-btn" onClick={() => setShowAnalytics(true)} title="Analytics & Insights"><BarChart3 size={14} /></button>
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
            ) : (() => {
              // ChatGPT/Claude-style sidebar: pinned first (no bucket header),
              // then temporal buckets ("Hoje", "Ontem", "7 dias"…). Buckets with
              // zero items are omitted by groupByBucket.
              const all = convManager.filteredConversations
              const pinned = all.filter(c => convManager.pinnedConvs.has(c.id))
              const rest = all.filter(c => !convManager.pinnedConvs.has(c.id))
              const buckets = groupByBucket(rest)
              const renderItem = (conv: typeof all[number]) => (
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
              )
              return (
                <>
                  {pinned.length > 0 && (
                    <div className="conv-bucket">
                      <div className="conv-bucket-label">{settings.language === 'en' ? 'Pinned' : 'Fixadas'}</div>
                      {pinned.map(renderItem)}
                    </div>
                  )}
                  {buckets.map(([b, items]) => (
                    <div key={b} className="conv-bucket">
                      <div className="conv-bucket-label">{bucketLabel(b, settings.language)}</div>
                      {items.map(renderItem)}
                    </div>
                  ))}
                </>
              )
            })()}
          </div>

          <div className="sidebar-footer">
            {/* ── User identity row (Claude-Desktop style) ─────────────
                Trigger for UserMenu + inline theme toggle. Shown even
                without a session (renders as "Convidado"); the menu
                offers a sign-in entry point in that state. */}
            <div className="sidebar-user">
              <button
                ref={userMenuAnchorRef}
                className="sidebar-user-trigger"
                onClick={() => setShowUserMenu(v => !v)}
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
                title={settings.language === 'en' ? 'Profile & preferences' : 'Perfil e preferências'}
              >
                <span className="sidebar-user-avatar">
                  {(settings.profileName || 'OC')[0]?.toUpperCase()}
                </span>
                <span className="sidebar-user-name">
                  {settings.profileName || (settings.language === 'en' ? 'OpenClaude' : 'OpenClaude')}
                </span>
              </button>
              <button
                className="sidebar-user-theme"
                onClick={cycleTheme}
                title={themeLabel}
                aria-label={themeLabel}
              >
                {themeIcon}
              </button>
              {showUserMenu && (
                <UserMenu
                  open={showUserMenu}
                  onClose={() => setShowUserMenu(false)}
                  anchorRef={userMenuAnchorRef}
                  language={settings.language}
                  onLanguageChange={(lang) => { setSettings(s => ({ ...s, language: lang })); }}
                  profileName={settings.profileName || 'OpenClaude'}
                  onProfileNameChange={(name) => setSettings(s => ({ ...s, profileName: name }))}
                  onOpenSettings={() => setShowSettings(true)}
                  onOpenDashboard={() => setShowAgentDashboard(true)}
                  onOpenAccentPicker={() => setShowAccentPicker(true)}
                  onCycleTheme={cycleTheme}
                  themeLabel={themeLabel}
                  appVersion="2.12.5"
                />
              )}
            </div>

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
                        {msg.content && <CopyButton text={msg.content} title={settings.language === 'en' ? 'Copy as Markdown' : 'Copiar como Markdown'} onCopied={() => showToast(settings.language === 'en' ? 'Copied as Markdown' : 'Copiado como Markdown')} />}
                        {msg.role === 'assistant' && (
                          <button
                            className="msg-action-btn msg-regen-btn"
                            onClick={() => regenerateResponse()}
                            title={settings.language === 'en' ? 'Regenerate this response' : 'Regenerar esta resposta'}
                            aria-label="Regenerate"
                          >
                            <RefreshCw size={12} />
                          </button>
                        )}
                        {activeConv && (
                          <button
                            className="msg-action-btn msg-branch-btn"
                            onClick={() => {
                              const idx = activeConv.messages.findIndex(m => m.id === msg.id)
                              if (idx < 0) return
                              forkFrom(activeConv.id, idx)
                              showToast(settings.language === 'en' ? 'Conversation branched' : 'Conversa bifurcada')
                            }}
                            title={settings.language === 'en' ? 'Branch from here' : 'Bifurcar a partir daqui'}
                            aria-label="Branch"
                          >
                            <GitBranch size={12} />
                          </button>
                        )}
                        <button className="msg-action-btn" onClick={() => deleteMessage(msg.id)} title={settings.language === 'en' ? 'Delete message' : 'Excluir mensagem'}><Trash size={12} /></button>
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
                  <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(chat.streamingText, false) }} />
                  <span className="streaming-cursor" />
                </div>
              </div>
            )}
            {/* Typing indicator — only while waiting for the first token.
                Once streamingText has content, the streaming bubble above
                already shows a blinking cursor; rendering dots here too
                produces a double-indicator race (bug in v2.9.x). */}
            {isActiveConvLoading && !(chat.isStreaming && chat.streamingText) && (
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
            <AmbientOrb visible={isActiveConvLoading} />
            <div className="input-wrapper">
              <input type="file" id="image-upload" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => { setInput(prev => prev + `\n[Imagem: ${file.name}]\n`); showToast(`Imagem ${file.name} anexada`) }
                reader.readAsDataURL(file)
                e.target.value = ''
              }} />

              {/* Status row: permission mode pill SEMPRE visível (fica
                  alinhado em cima do input-pill, como no Claude Desktop),
                  + pills transientes (agente, persona, RAG, loading).
                  A pill de permissão cobre o caso `ignore` com dot
                  pulsante — então o status-pill "Bypass Mode" dedicado
                  foi removido para evitar redundância. */}
              <div className="input-status-bar">
                <PermissionModeButton
                  value={settings.permissionLevel || 'ask'}
                  onChange={(level) => setSettings(s => ({ ...s, permissionLevel: level }))}
                  language={settings.language}
                />
                {isAgentMode && <span className="status-pill agent"><Zap size={9} />Agente{isActiveConvLoading ? ` · Passo ${chat.agentSteps}` : ''}</span>}
                {activePersona && <span className="status-pill persona"><UserCog size={9} />{activePersona.name}</span>}
                {ragEnabled && <span className="status-pill rag"><Database size={9} />RAG</span>}
                {profiles.activeProfile && <span className="status-pill profile">{profiles.activeProfile.icon} {profiles.activeProfile.name}</span>}
                {isActiveConvLoading && <button className="status-pill stop-pill" onClick={chat.stopAgent}><Square size={9} />Parar</button>}
              </div>

              <SlashPopover
                slash={slash}
                selectedIdx={slashIdx}
                onHover={setSlashIdx}
                onExecute={executeSlash}
                language={settings.language}
              />
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
                  <button
                    ref={contextPanelAnchorRef}
                    type="button"
                    className={`token-counter ${tokenInfo.critical ? 'critical' : tokenInfo.warning ? 'warning' : ''}`}
                    onClick={() => setShowContextPanel(v => !v)}
                    title={settings.language === 'en' ? 'Open context window panel' : 'Abrir painel da janela de contexto'}
                  >
                    {formatTokenCount(tokenInfo.used)}/{formatTokenCount(tokenInfo.limit)} ({tokenInfo.percentage}%)
                  </button>
                  <ContextWindowPanel
                    open={showContextPanel}
                    onClose={() => setShowContextPanel(false)}
                    anchorRef={contextPanelAnchorRef}
                    breakdown={ctxBreakdown}
                    language={settings.language}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
