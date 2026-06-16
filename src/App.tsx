import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react'
import 'highlight.js/styles/github-dark.css'
import { Send, Plus, Trash2, Minus, Square, X, Bot, Loader2, ChevronDown, ArrowDown, Search, Settings as SettingsIcon, Download, FileText, XCircle, MessageSquare, Code, Globe, ArrowUpCircle, Zap, BotOff, RefreshCw, Pin, PanelLeftClose, PanelLeft, Sun, Moon, Contrast, Palette, Image, Mic, ListChecks, CheckCircle2, Circle, AlertCircle, Clock, BarChart3, Database, UserCog, Activity, Folder, Wrench, BrainCircuit, Check } from 'lucide-react'
import { loadSettings, type AppSettings } from './settingsConfig'
import type { Persona } from './PersonaEngine'
// Small / hot-path components — eager
import CommandPalette from './components/CommandPalette'
import Toasts from './components/Toasts'
import OnboardingModal from './components/OnboardingModal'
import ChatMessage from './components/ChatMessage'
import AgentStepsGroup from './components/AgentStepsGroup'
import { groupMessages } from './utils/messageGroups'
import { useStableCallback } from './hooks/useStableCallback'
import { ThinkingTimer } from './components/ThinkingTimer'
import ProjectsBar from './components/ProjectsBar'
import ProjectEditModal from './components/ProjectEditModal'
import { useProjects } from './hooks/useProjects'
import { conversationsInProject, countByProject, removeProject, projectInstructionsAddition, projectCwdAddition } from './utils/projects'
import type { Project, Conversation } from './types'

// Heavy feature panels — lazy-loaded on first use.
// Saves ~1MB from initial bundle; each chunk loads async when user opens the modal.
const AnalyticsDashboard = lazy(() => import('./Analytics'))
const DevInsightsPanel = lazy(() => import('./DevInsightsPanel'))
const ArtifactPanel = lazy(() => import('./ArtifactPanel'))
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
import { streamPhaseLabel } from './utils/streamPhase'
import { buildSwitchOptions, groupSwitchOptions, type SwitchOption } from './utils/modelSwitcher'
import { mergeSkills, skillManifestHeaders } from './utils/skills'
import type { Skill } from './types/skill'
const SkillManager = lazy(() => import('./SkillManager'))

// ─── Custom hooks ───────────────────────────────────────────────────
import { useProviderConfig, getDisplayModel } from './hooks/useProviderConfig'
import { useVoice } from './hooks/useVoice'
import { useConversations } from './hooks/useConversations'
import { useToolExecution } from './hooks/useToolExecution'
import { useModalKeyPool } from './hooks/useModalKeyPool'
import { useMcp } from './hooks/useMcp'
import { useSkillInduction } from './hooks/useSkillInduction'
import { useSemanticSkills } from './hooks/useSemanticSkills'
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
import EffortSlider from './components/EffortSlider'
import ContextWindowPanel from './components/ContextWindowPanel'
import { useContextBreakdown } from './hooks/useContextBreakdown'
import { useMathReady } from './hooks/useMathReady'
import { useTokenizerReady } from './hooks/useTokenizerReady'
import { partitionTools, decideDeferral } from './services/toolDeferral'
import { TOOLS } from './constants/tools'
import { getModelContextLimit, effectiveContextLimit, countToolSchemas } from './services/contextEngine'
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
import { type Artifact } from './utils/artifacts'
import { formatDroppedFile } from './utils/attachments'
import { runCompaction, mergeSummary } from './services/compaction'
import { renderConversationTranscript, buildImportedContextBlock, IMPORT_VERBATIM_CHAR_BUDGET } from './utils/conversationContext'
import { renderWorkingMemory, renderPersistentMemory } from './utils/memoryRender'
import { collectLocalStorageBackup, buildBackup, parseBackup, applyLocalStorageBackup } from './utils/backup'

// ─── App ─────────────────────────────────────────────────────────────
export default function App() {
  // Upgrade raw `$…$` to typeset math once KaTeX finishes lazy-loading. The
  // flag is threaded into each memoized <ChatMessage> so the memo breaks
  // exactly once when the lib arrives (App re-rendering alone no longer
  // repaints memoized messages).
  const mathReady = useMathReady()
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
  // Step-group keys the user toggled away from their default state (live
  // groups default open, finished groups default collapsed) — v2.12.71.
  const [toggledStepGroups, setToggledStepGroups] = useState<Set<string>>(new Set())
  // "Voltar ao fim" pill: visible when the user scrolled up — during 3-min
  // agent turns they read history while the turn streams below (v2.12.71).
  const [showJumpBtn, setShowJumpBtn] = useState(false)
  // Message typed mid-turn, waiting for the conversation to idle (v2.12.52 —
  // the composer no longer locks for the whole 3–10 min turn). convId pins
  // the queue to the conversation it was typed in.
  const [queuedMessage, setQueuedMessage] = useState<{ text: string; convId: string | null } | null>(null)
  const [taskPlanCollapsed, setTaskPlanCollapsed] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<{available: boolean, releaseUrl: string, latestVersion: string} | null>(null)
  // Auto-update (electron-updater): set once a new version finished downloading
  // in the background, which reveals the Claude-style "Reiniciar para atualizar"
  // button in the sidebar footer.
  const [updateReady, setUpdateReady] = useState<{ version?: string } | null>(null)
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
  const [showDevInsights, setShowDevInsights] = useState(false)
  const [openArtifact, setOpenArtifact] = useState<Artifact | null>(null)
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
  // Skills (v2.27.0): builtins + criadas pelo usuário, mescladas. Persistidas
  // via IPC (skill-load/skill-save), espelhando personas.
  const [skills, setSkills] = useState<Skill[]>(() => mergeSkills([]))
  const [showSkills, setShowSkills] = useState(false)
  useEffect(() => {
    window.electron.skillLoad?.()
      .then((res: any) => { if (res?.skills) setSkills(mergeSkills(res.skills)) })
      .catch(() => { /* primeira execução / sem arquivo */ })
  }, [])
  const persistSkills = useCallback((next: Skill[]) => {
    setSkills(next)
    window.electron.skillSave?.(next).catch((e: any) => console.warn('[skills] save error:', e))
  }, [])
  // Ref de skills atuais (usado pelos hooks de auto-aprendizado/semântico, que
  // rodam em background/closures — evita estado obsoleto).
  const skillsRef = useRef(skills)
  skillsRef.current = skills
  // Continuar a partir de outra conversa (v2.58.0)
  const [showConvPicker, setShowConvPicker] = useState(false)
  const [importingCtx, setImportingCtx] = useState(false)
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
  // Last seen scrollTop — lets the scroll handler tell a user scroll-UP (which
  // must disengage auto-stick) from the programmatic scroll-to-bottom.
  const lastScrollTopRef = useRef(0)

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

  // ─── Projects (workspaces, v2.12.42) ───────────────────────────
  const projManager = useProjects()
  const [assigningConvId, setAssigningConvId] = useState<string | null>(null)
  const projectCounts = useMemo(() => countByProject(convManager.conversations), [convManager.conversations])
  const handleNewConversation = useCallback(() => {
    const id = convManager.newConversation()
    const pid = projManager.activeProjectId
    if (pid) convManager.setConversations(prev => prev.map(c => (c.id === id ? { ...c, projectId: pid } : c)))
  }, [convManager, projManager.activeProjectId])
  const assignConvToProject = useCallback((convId: string, projectId: string | undefined) => {
    convManager.setConversations(prev => prev.map(c => (c.id === convId ? { ...c, projectId } : c)))
    setAssigningConvId(null)
  }, [convManager])
  const handleProjectChipSelect = useCallback((projectId: string | null) => {
    if (assigningConvId) assignConvToProject(assigningConvId, projectId ?? undefined)
    else projManager.setActiveProjectId(projectId)
  }, [assigningConvId, assignConvToProject, projManager])
  const handleDeleteProject = useCallback((projectId: string) => {
    const res = removeProject(projManager.projects, convManager.conversations, projectId)
    projManager.setProjects(res.projects)
    convManager.setConversations(res.conversations)
    if (projManager.activeProjectId === projectId) projManager.setActiveProjectId(null)
    showToast('Projeto excluído (conversas preservadas)')
  }, [projManager, convManager, showToast])
  // ─── Backup / restore (v2.12.62) ───────────────────────────────
  const handleExportData = useCallback(async () => {
    try {
      const res = await window.electron.exportUserData()
      const envelope = buildBackup(collectLocalStorageBackup(localStorage), res.files || {}, new Date().toISOString())
      const dlg = await window.electron.saveDialog({
        defaultName: `openclaude-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!dlg.filePath) return
      const w = await window.electron.writeFile({ filePath: dlg.filePath, content: JSON.stringify(envelope, null, 2) })
      showToast(w.error
        ? (settings.language === 'en' ? `Export failed: ${w.error}` : `Falha ao exportar: ${w.error}`)
        : (settings.language === 'en' ? 'Backup exported' : 'Backup exportado com sucesso'))
    } catch (e: any) {
      showToast((settings.language === 'en' ? 'Export failed: ' : 'Falha ao exportar: ') + (e?.message || e))
    }
  }, [showToast, settings.language])

  const handleImportData = useCallback(async () => {
    try {
      const dlg = await window.electron.openFileDialog({ filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (dlg.canceled || !dlg.filePaths?.[0]) return
      const read = await window.electron.readFile(dlg.filePaths[0])
      if (!read.content) {
        showToast(settings.language === 'en' ? 'Could not read the file.' : 'Não foi possível ler o arquivo.')
        return
      }
      let envelope
      try { envelope = parseBackup(read.content) } catch (e: any) { showToast(e.message); return }
      // Restoring overwrites current data — confirm first so a misclick can't
      // wipe the active corpus (this is the one destructive step).
      const ok = window.confirm(settings.language === 'en'
        ? 'Importing will REPLACE your current conversations, memory and settings with the backup. Continue?'
        : 'Importar vai SUBSTITUIR suas conversas, memória e configurações atuais pelas do backup. Continuar?')
      if (!ok) return
      applyLocalStorageBackup(localStorage, envelope.localStorage)
      const res = await window.electron.importUserData({ files: envelope.files })
      if (res.error) {
        showToast((settings.language === 'en' ? 'Restore failed: ' : 'Falha ao restaurar: ') + res.error)
        return
      }
      showToast(settings.language === 'en'
        ? `Backup restored (${res.restored} files). Reloading…`
        : `Backup restaurado (${res.restored} arquivos). Recarregando…`)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e: any) {
      showToast((settings.language === 'en' ? 'Import failed: ' : 'Falha ao importar: ') + (e?.message || e))
    }
  }, [showToast, settings.language])

  // Delete a conversation with an undo window (a single click used to destroy a
  // multi-minute agent session for good). Capture the object + prior active id
  // so Undo restores both.
  const handleDeleteConversation = useCallback((conv: Conversation) => {
    const prevActiveId = convManager.activeConvId
    convManager.deleteConversation(conv.id)
    showToast({
      message: settings.language === 'en' ? 'Conversation deleted' : 'Conversa excluída',
      severity: 'info',
      duration: 7000,
      action: {
        label: settings.language === 'en' ? 'Undo' : 'Desfazer',
        onClick: () => {
          convManager.setConversations(prev => prev.some(c => c.id === conv.id) ? prev : [conv, ...prev])
          convManager.setActiveConvId(prevActiveId)
        },
      },
    })
  }, [convManager, showToast, settings.language])
  const handleCreateProject = useCallback((name: string) => {
    const p = projManager.createProject(name)
    if (p) projManager.setActiveProjectId(p.id)
  }, [projManager])
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const handleSaveProject = useCallback((patch: { name: string; instructions: string; cwd: string }) => {
    if (editingProject) projManager.updateProject(editingProject.id, patch)
    setEditingProject(null)
  }, [editingProject, projManager])
  // Projects ciclo 2: inject the active conversation's project instructions into
  // the system prompt (a thin layer over effectiveSettings, so useChat needs no
  // change — it already reads settings.systemPrompt).
  const effectiveSettingsWithProject = useMemo(() => {
    const conv = convManager.activeConv
    if (!conv?.projectId) return effectiveSettings
    const project = projManager.projects.find(p => p.id === conv.projectId)
    const addition = projectInstructionsAddition(project) + projectCwdAddition(project)
    if (!addition) return effectiveSettings
    return { ...effectiveSettings, systemPrompt: (effectiveSettings.systemPrompt || '') + addition }
  }, [effectiveSettings, convManager.activeConv?.projectId, projManager.projects])
  // Projects ciclo 4 (v2.12.47): the project folder is no longer prompt-only —
  // execute_command actually runs there (default cwd, model can override).
  const activeProjectCwd = useMemo(() => {
    const conv = convManager.activeConv
    if (!conv?.projectId) return undefined
    return projManager.projects.find(p => p.id === conv.projectId)?.cwd?.trim() || undefined
  }, [convManager.activeConv?.projectId, projManager.projects])
  // useConversationFork has its own local Message shape that omits id/timestamp;
  // our app's Message is stricter. The fork logic only reads role/content/
  // arbitrary fields via spread, so the mismatch is cosmetic — cast away.
  const { forkFrom } = useConversationFork({
    conversationsRef: convManager.conversationsRef as any,
    setConversations: convManager.setConversations as any,
    setActiveConvId: convManager.setActiveConvId,
  })

  const modalKeyPool = useModalKeyPool(settings)
  // MCP ponta a ponta (v2.35.0): conecta nos servidores configurados, expõe as
  // tools ao modelo (extraTools) e roteia as chamadas mcp__* (callMcpTool).
  const mcp = useMcp(effectiveSettings.mcpServers)

  const toolExec = useToolExecution({
    settings: effectiveSettings,
    activeConvId: convManager.activeConvId,
    setConversations: convManager.setConversations,
    selectedModel,
    modalKeyPool,
    projectCwd: activeProjectCwd,
    skills,
    callMcpTool: mcp.callMcpTool,
  })

  // Matching semântico de skills (Fase 5, v2.56.0) — opt-in, best-effort (Ollama).
  const semantic = useSemanticSkills({
    enabled: effectiveSettings.memoryEnabled !== false && effectiveSettings.semanticSkillMatch === true,
    skillsRef,
  })

  const chat = useChat({
    settings: effectiveSettingsWithProject,
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
    skills,
    extraTools: mcp.mcpTools,
    semanticMatch: semantic.matchSemantic,
  })

  const activeConv = convManager.activeConv
  // True only when the currently visible conversation is the one loading
  const isActiveConvLoading = chat.isLoading && chat.streamingConvId === convManager.activeConvId

  // Continuar a partir de outra conversa (v2.58.0): renderiza a conversa-fonte
  // (verbatim se couber; resumida via LLM se for grande) e injeta no
  // contextSummary da conversa ATUAL — que o useChat já manda todo turno.
  const importContextFrom = useCallback(async (sourceId: string) => {
    setShowConvPicker(false)
    const targetId = convManager.activeConvId
    const source = convManager.conversationsRef.current.find(c => c.id === sourceId)
    if (!source || !targetId || source.id === targetId || (source.messages?.length || 0) === 0) return
    const lang: 'pt' | 'en' = settings.language === 'en' ? 'en' : 'pt'
    setImportingCtx(true)
    try {
      const transcript = renderConversationTranscript(source)
      let body = transcript
      if (transcript.length > IMPORT_VERBATIM_CHAR_BUDGET) {
        showToast(lang === 'en' ? 'Summarizing the selected conversation…' : 'Resumindo a conversa selecionada…')
        const res = await runCompaction(providerConfig, source.messages, lang)
        body = res.summary || (transcript.slice(0, IMPORT_VERBATIM_CHAR_BUDGET) + ' …[truncado]')
      }
      const block = buildImportedContextBlock(source.title, body)
      convManager.setConversations(prev => prev.map(c =>
        c.id === targetId ? { ...c, contextSummary: block, importedFromTitle: source.title } : c,
      ))
      showToast(lang === 'en' ? `Context loaded from "${source.title}"` : `Contexto carregado de "${source.title}"`)
    } catch (e) {
      showToast(lang === 'en' ? 'Failed to import context' : 'Falha ao importar contexto')
    } finally {
      setImportingCtx(false)
    }
  }, [convManager, settings.language, providerConfig, showToast])
  const tokenInfo = useTokenCounter(activeConv, providerConfig.model, input)

  // Auto-fechar o plano quando TODAS as tarefas concluem (estilo Claude: o
  // todo-list some sozinho ao terminar). Pequeno atraso pra ver o "tudo verde"
  // antes de sumir. O botão X continua para fechar antes da hora.
  useEffect(() => {
    const plan = activeConv?.taskPlan
    if (!plan || plan.tasks.length === 0) return
    if (!plan.tasks.every(t => t.status === 'done')) return
    const convId = activeConv.id
    const timer = setTimeout(() => {
      convManager.setConversations(prev => prev.map(c =>
        c.id === convId ? { ...c, taskPlan: undefined } : c
      ))
    }, 4000)
    return () => clearTimeout(timer)
  }, [activeConv?.taskPlan, activeConv?.id, convManager.setConversations])

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
  // Persistent memory text for the panel accounting — loaded via the same
  // renderer (memoryRender.ts) the chat pipeline injects, so the panel counts
  // exactly what goes into requests. Refreshes when the panel opens.
  const [persistentMemoryText, setPersistentMemoryText] = useState('')
  useEffect(() => {
    if (!settings.memoryEnabled) { setPersistentMemoryText(''); return }
    window.electron.loadMemory()
      .then((mem: any) => setPersistentMemoryText(renderPersistentMemory(mem)))
      .catch(() => setPersistentMemoryText(''))
  }, [settings.memoryEnabled, showContextPanel])
  // Everything injected as "memory" each turn: running summary + the agent's
  // working-memory reminder + persistent facts. The panel used to count ONLY
  // contextSummary — which (compaction being broken on cloud providers) was
  // always empty, so "Memória / resumo" showed a permanent 0 even with
  // memory in every request.
  const memoryText = useMemo(() => {
    const parts: string[] = []
    if (activeConv?.contextSummary) parts.push(activeConv.contextSummary)
    const wm = renderWorkingMemory(activeConv?.workingMemory)
    if (wm) parts.push(wm)
    if (persistentMemoryText) parts.push(persistentMemoryText)
    return parts.join('\n\n')
  }, [activeConv?.contextSummary, activeConv?.workingMemory, persistentMemoryText])
  const ctxBreakdown = useContextBreakdown({
    activeConv,
    model: providerConfig.model,
    // Ollama: janela REAL (num_ctx), não a teórica — alinha o painel com o que
    // o chat realmente envia e evita o falso "106%" do modelo local (v2.24.0).
    limit: effectiveContextLimit(settings.provider, providerConfig.model, settings.ollamaNumCtx),
    inputText: input,
    systemPrompt: settings.systemPrompt || '',
    memoryText,
    eagerTools: toolPartition.eager,
    deferredToolNames: toolPartition.deferredNames,
    deferredToolSchemas: (TOOLS as any[]).filter((t: any) => toolPartition.deferredNames.some(d => d.name === t.function.name)) as any,
    skillHeaders: skillManifestHeaders(skills),
    mcpToolDefs: mcp.mcpTools,
    active: showContextPanel,
  })

  useMemoryDreaming({
    enabled: settings.memoryEnabled,
    onToast: showToast,
  })

  // Indução de skills de domínio em background (Fase 3, v2.54.0): clusteriza os
  // fatos persistidos por domínio e rascunha skills aprendidas em staging.
  useSkillInduction({
    enabled: settings.memoryEnabled,
    skillsRef,
    persistSkills,
    onToast: showToast,
    language: settings.language,
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
      ['agentDashboard', showAgentDashboard], ['devInsights', showDevInsights],
    ]
    for (const [name, open] of flags) {
      if (open && !prevFeatureOpen.current[name]) logInsight('feature', 'open', { feature: name })
      prevFeatureOpen.current[name] = open
    }
  }, [showSettings, showAnalytics, showParliament, showVault, showPersona, showArena, showRAG, showWorkflow, showOrion, showVision, showCodeWorkspace, showProfiles, showScheduler, showAgentDashboard, showDevInsights])

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

  // ─── Auto-update events (electron-updater, Claude-style) ────────
  // The main process downloads new releases in the background and emits
  // 'update-status'. When one finishes downloading we surface the
  // "Reiniciar para atualizar" button; the manual banner above stays as a
  // fallback for environments where auto-download can't run.
  useEffect(() => {
    if (!window.electron.onUpdateStatus) return
    const off = window.electron.onUpdateStatus((data) => {
      if (data?.state === 'downloaded') setUpdateReady({ version: data.version })
    })
    return off
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
      const near = scrollHeight - scrollTop - clientHeight < 80
      // A deliberate scroll UP disengages auto-stick IMMEDIATELY (don't make
      // the user cross the 80px threshold first) so they can read history while
      // a long agent turn streams below. Auto-scroll only ever moves DOWN, so
      // it never trips this branch. Scrolling back down to within 80px
      // re-engages. This is what lets the user scroll during a live turn.
      if (scrollTop < lastScrollTopRef.current - 4) {
        isNearBottomRef.current = false
      } else if (near) {
        isNearBottomRef.current = true
      }
      lastScrollTopRef.current = scrollTop
      setShowJumpBtn(!isNearBottomRef.current)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (!isNearBottomRef.current) return
    const c = messagesContainerRef.current
    if (!c) return
    // Instant (not smooth): a per-chunk smooth scrollIntoView during a fast
    // live agent turn never finishes before the next fires, so the scroll
    // animates forever and the user can't move it. Pinning scrollTop sticks to
    // the bottom without an animation that fights manual scrolling.
    c.scrollTop = c.scrollHeight
    lastScrollTopRef.current = c.scrollTop
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
      [showDevInsights, () => setShowDevInsights(false)],
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
          // Electron 32+ removed the non-standard File.path — without
          // webUtils.getPathForFile (via preload) drops silently did nothing.
          const filePath = window.electron.getPathForFile
            ? window.electron.getPathForFile(file)
            : (file as any).path
          if (filePath) {
            try {
              const result = await window.electron.readDroppedFile(filePath)
              if (result.content) {
                setInput(prev => prev + formatDroppedFile(result.name || filePath, result.content!))
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

  // ─── Stable handlers for the memoized <ChatMessage> list ────────
  // Each prop handed to ChatMessage must keep a permanent identity — one
  // fresh-identity handler defeats React.memo and puts the whole history
  // back on the per-streaming-chunk re-render path (regenerateResponse, for
  // instance, gets a new identity whenever activeConv/settings change).
  const handleToggleToolCollapse = useStableCallback((toolKey: string) => {
    setCollapsedTools(prev => {
      const next = new Set(prev)
      if (next.has(toolKey)) next.delete(toolKey); else next.add(toolKey)
      return next
    })
  })
  const handleToggleStepGroup = useStableCallback((key: string) => {
    setToggledStepGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  })
  const handleRegenerate = useStableCallback(() => regenerateResponse())
  const handleDeleteMessage = useStableCallback(deleteMessage)
  const handleBranchFrom = useStableCallback((msgId: string) => {
    if (!activeConv) return
    const idx = activeConv.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return
    forkFrom(activeConv.id, idx)
    showToast(settings.language === 'en' ? 'Conversation branched' : 'Conversa bifurcada')
  })

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
          // Provider-agnostic since v2.12.53 (the old IPC silently skipped
          // every cloud provider) — and `/compact <instruções>` now actually
          // reaches the summarizer prompt.
          const res = await runCompaction(providerConfig, conv.messages, lang, clean || undefined)
          if (res.summary) {
            const trimmed = mergeSummary(conv.contextSummary || '', res.summary, undefined, lang)
            convManager.setConversations(list => list.map(c =>
              c.id !== conv.id ? c : { ...c, contextSummary: trimmed }
            ))
            logInsight('context', 'compaction', { manual: true })
            showToast(lang === 'en' ? 'Context compacted' : 'Contexto compactado', 'success')
          } else {
            console.warn('[slash/compact] failed:', res.error)
            showToast(res.error
              ? (lang === 'en' ? `Compact failed: ${res.error}` : `Falha ao compactar: ${res.error}`)
              : (lang === 'en' ? 'Compact returned no summary' : 'Compactação sem resumo'), 'error')
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
    // Mid-turn (turns run 3–10 min on Modal): queue instead of dropping the
    // user on a disabled composer. Auto-sends when this conversation idles.
    if (isActiveConvLoading) {
      setQueuedMessage({ text: payload.trim(), convId: convManager.activeConvId })
      setInput('')
      return
    }
    sendMessageRef.current(payload.trim())
    setInput('')
  }, [input, slash, slashIdx, executeSlash, isActiveConvLoading, convManager.activeConvId])

  // Fire the queued message once ITS conversation goes idle (switching to
  // another conversation keeps it parked until the user returns).
  useEffect(() => {
    if (queuedMessage && !isActiveConvLoading && queuedMessage.convId === convManager.activeConvId) {
      const msg = queuedMessage.text
      setQueuedMessage(null)
      // Let the finished turn's state settle before re-entering sendMessage
      // (same pattern as regenerateResponse).
      setTimeout(() => sendMessageRef.current(msg), 80)
    }
  }, [queuedMessage, isActiveConvLoading, convManager.activeConvId])

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

  // Troca rápida de modelo/provider direto no chat (v2.23.0). Reaproveita os
  // padrões de persistência existentes: provider em settings, modelo Ollama em
  // selectedModel + localStorage.
  const switchOptions = useMemo(() => buildSwitchOptions(settings, models, selectedModel), [settings, models, selectedModel])
  const switchTo = useCallback((opt: SwitchOption) => {
    if (opt.provider === 'ollama') {
      setSelectedModel(opt.model)
      localStorage.setItem('openclaude-model', opt.model)
    }
    if (opt.provider !== settings.provider) {
      setSettings(prev => {
        const next = { ...prev, provider: opt.provider as AppSettings['provider'] }
        localStorage.setItem('openclaude-settings', JSON.stringify(next))
        return next
      })
    }
    setShowModelDropdown(false)
  }, [settings.provider])

  // ─── Agent-turn grouping (v2.12.71) ─────────────────────────────
  // Consecutive tool-step messages render as one compact collapsible
  // block instead of N full message rows. Memoized on the messages
  // array identity, so per-chunk streaming re-renders reuse it.
  const renderItems = useMemo(
    () => (activeConv ? groupMessages(activeConv.messages) : []),
    [activeConv?.messages],
  )
  // The tail group of a running turn stays open (live progress);
  // finished groups collapse to the summary line.
  const lastRenderItem = renderItems[renderItems.length - 1]
  const liveGroupKey = isActiveConvLoading && lastRenderItem?.kind === 'steps' ? lastRenderItem.key : null
  // When a turn finishes, drop any toggle override on the group that was
  // live — the toggle semantics flip with the default (live=open,
  // done=collapsed), so a "collapse while live" override would otherwise
  // re-EXPAND the group the moment the turn ends.
  const prevLiveGroupKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevLiveGroupKeyRef.current
    prevLiveGroupKeyRef.current = liveGroupKey
    if (prev && prev !== liveGroupKey) {
      setToggledStepGroups(s => {
        if (!s.has(prev)) return s
        const next = new Set(s); next.delete(prev); return next
      })
    }
  }, [liveGroupKey])

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
            mcpStatus={mcp.mcpStatus}
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
        onOpenSkills={() => setShowSkills(true)}
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
        {showDevInsights && <DevInsightsPanel isOpen={showDevInsights} onClose={() => setShowDevInsights(false)} language={settings.language} providerConfig={providerConfig} />}
        {showSkills && <SkillManager isOpen={showSkills} onClose={() => setShowSkills(false)} skills={skills} onSave={persistSkills} language={settings.language} />}
        {showConvPicker && (
          <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowConvPicker(false) }}>
            <div className="analytics-modal" style={{ maxWidth: 540 }}>
              <div className="analytics-header">
                <div className="analytics-title-group">
                  <MessageSquare size={20} />
                  <div>
                    <h2>{settings.language === 'en' ? 'Continue from a conversation' : 'Continuar de uma conversa'}</h2>
                    <p className="analytics-subtitle">
                      {settings.language === 'en'
                        ? 'Pick a conversation — its content is loaded as context so the AI continues from it.'
                        : 'Escolha uma conversa — o conteúdo dela é carregado como contexto para a IA continuar a partir daí.'}
                    </p>
                  </div>
                </div>
                <button className="settings-close" onClick={() => setShowConvPicker(false)}><X size={18} /></button>
              </div>
              <div style={{ padding: '8px 16px 16px', overflowY: 'auto', flex: 1 }}>
                {convManager.conversations.filter(c => c.id !== convManager.activeConvId && (c.messages?.length || 0) > 0).length === 0 && (
                  <p style={{ opacity: 0.6, padding: '12px 4px' }}>{settings.language === 'en' ? 'No other conversations yet.' : 'Nenhuma outra conversa ainda.'}</p>
                )}
                {convManager.conversations
                  .filter(c => c.id !== convManager.activeConvId && (c.messages?.length || 0) > 0)
                  .map(c => (
                    <button key={c.id} className="conv-pick-item" onClick={() => importContextFrom(c.id)}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || (settings.language === 'en' ? '(untitled)' : '(sem título)')}</div>
                        <div style={{ fontSize: 11, opacity: 0.6 }}>{c.messages.length} {settings.language === 'en' ? 'messages' : 'mensagens'} · {new Date(c.createdAt).toLocaleDateString(settings.language === 'en' ? 'en-US' : 'pt-BR')}</div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
        {editingProject && <ProjectEditModal project={editingProject} onSave={handleSaveProject} onClose={() => setEditingProject(null)} />}
        {openArtifact && (
          <Suspense fallback={null}>
            <ArtifactPanel artifact={openArtifact} onClose={() => setOpenArtifact(null)} language={settings.language} />
          </Suspense>
        )}
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
          <button className="titlebar-action-btn" onClick={() => setShowDevInsights(true)} title="Dev Insights — telemetria de uso (local, privada)"><Activity size={14} /></button>
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
            <button className="new-chat-btn" onClick={handleNewConversation}>
              <Plus size={16} /> Nova conversa
            </button>
            <div className="search-container">
              <Search size={14} className="search-icon" />
              <input ref={searchInputRef} type="text" value={convManager.searchQuery}
                onChange={e => convManager.setSearchQuery(e.target.value)}
                placeholder="Buscar conversas... (Ctrl+K)" className="search-input" />
            </div>
          </div>

          <ProjectsBar
            projects={projManager.projects}
            activeProjectId={projManager.activeProjectId}
            counts={projectCounts}
            assigning={!!assigningConvId}
            onSelect={handleProjectChipSelect}
            onCreate={handleCreateProject}
            onDelete={handleDeleteProject}
            onEdit={setEditingProject}
            onCancelAssign={() => setAssigningConvId(null)}
          />

          <div className="conversations-list">
            {convManager.loadingConversations ? (
              <>{[1,2,3,4,5].map(i => <div key={i} className="conv-item skeleton"><div className="skeleton-bar" /></div>)}</>
            ) : (() => {
              // ChatGPT/Claude-style sidebar: pinned first (no bucket header),
              // then temporal buckets ("Hoje", "Ontem", "7 dias"…). Buckets with
              // zero items are omitted by groupByBucket.
              const all = conversationsInProject(convManager.filteredConversations, projManager.activeProjectId)
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
                    <button className="conv-action-btn" onClick={(e) => { e.stopPropagation(); setAssigningConvId(conv.id) }} title="Mover para projeto">
                      <Folder size={12} />
                    </button>
                    <button className="conv-action-btn" onClick={(e) => { e.stopPropagation(); convManager.togglePin(conv.id) }} title={convManager.pinnedConvs.has(conv.id) ? 'Desafixar' : 'Fixar'}>
                      <Pin size={12} />
                    </button>
                    <button className="conv-action-btn conv-delete" onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv) }}>
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
            {/* ── "Restart to update" (Claude-Desktop style) ───────────
                Appears once electron-updater finished downloading a new
                version in the background; click → quit + relaunch on it. */}
            {updateReady && (
              <button
                className="sidebar-update-btn"
                onClick={() => window.electron.quitAndInstall?.()}
                title={settings.language === 'en' ? 'Restart to apply the update' : 'Reiniciar para aplicar a atualização'}
              >
                <RefreshCw size={16} className="sidebar-update-icon" />
                <span className="sidebar-update-text">
                  {settings.language === 'en' ? 'Restart to update' : 'Reiniciar para atualizar'}
                  {updateReady.version && <small>v{updateReady.version}</small>}
                </span>
                <ArrowUpCircle size={15} className="sidebar-update-arrow" />
              </button>
            )}
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
                  appVersion={__APP_VERSION__}
                  onExportData={handleExportData}
                  onImportData={handleImportData}
                />
              )}
            </div>

            {/* Troca rápida de modelo/provider no chat (v2.23.0) — alterna
                entre Modal, Ollama e qualquer provider configurado em 1 clique,
                estilo Claude, sem abrir Configurações. */}
            <div className="model-selector">
              <button className="model-btn" onClick={() => setShowModelDropdown(!showModelDropdown)}
                      title={settings.provider === 'ollama' ? 'Trocar modelo/provider' : `${settings.provider}: ${displayModel}`}>
                {settings.provider === 'ollama' ? <Bot size={14} /> : <Globe size={14} />}
                <span className="model-name">{settings.provider === 'ollama' ? selectedModel : `${settings.provider}: ${displayModel}`}</span>
                <ChevronDown size={12} />
              </button>
              {showModelDropdown && (
                <div className="model-dropdown">
                  {groupSwitchOptions(switchOptions).map(({ group, items }) => (
                    <div key={group} className="model-group">
                      <div className="model-group-label">{group}</div>
                      {items.map(opt => (
                        <button key={opt.provider + ':' + opt.model}
                          className={`model-option ${opt.active ? 'active' : ''}`}
                          onClick={() => switchTo(opt)}>
                          {opt.local ? <Bot size={12} className="model-option-icon" /> : <Globe size={12} className="model-option-icon" />}
                          <span className="model-option-label">{opt.label}</span>
                          {opt.active && <Check size={13} className="model-option-check" />}
                        </button>
                      ))}
                    </div>
                  ))}
                  <button className="model-option model-option-settings"
                    onClick={() => { setShowModelDropdown(false); setShowSettings(true) }}>
                    <SettingsIcon size={12} className="model-option-icon" />
                    <span className="model-option-label">Configurar providers…</span>
                  </button>
                </div>
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
                {activeConv?.importedFromTitle ? (
                  <div className="imported-context-chip" title={settings.language === 'en' ? 'This chat continues from another conversation' : 'Esta conversa continua a partir de outra'}>
                    <MessageSquare size={13} />
                    <span>{settings.language === 'en' ? 'Continuing from' : 'Continuando de'}: <strong>{activeConv.importedFromTitle}</strong></span>
                  </div>
                ) : (
                  <button className="continue-from-btn" disabled={importingCtx} onClick={() => setShowConvPicker(true)}>
                    <MessageSquare size={14} />
                    {importingCtx
                      ? (settings.language === 'en' ? 'Loading context…' : 'Carregando contexto…')
                      : (settings.language === 'en' ? 'Continue from a previous conversation' : 'Continuar de uma conversa anterior')}
                  </button>
                )}
              </div>
            ) : (
              renderItems.map(item => item.kind === 'steps' ? (
                <AgentStepsGroup
                  key={item.key}
                  msgs={item.msgs}
                  groupKey={item.key}
                  language={settings.language}
                  live={item.key === liveGroupKey}
                  expanded={item.key === liveGroupKey ? !toggledStepGroups.has(item.key) : toggledStepGroups.has(item.key)}
                  onToggleExpanded={handleToggleStepGroup}
                  mathReady={mathReady}
                  showThinking={settings.showThinking !== false}
                  collapsedTools={collapsedTools}
                  onToggleCollapse={handleToggleToolCollapse}
                />
              ) : (
                <ChatMessage
                  key={item.msg.id}
                  msg={item.msg}
                  language={settings.language}
                  showThinking={settings.showThinking !== false}
                  mathReady={mathReady}
                  collapsedTools={collapsedTools}
                  onToggleCollapse={handleToggleToolCollapse}
                  onOpenArtifact={setOpenArtifact}
                  onRegenerate={handleRegenerate}
                  onBranch={handleBranchFrom}
                  onDelete={handleDeleteMessage}
                  showToast={showToast}
                />
              ))
            )}
            {/* Streaming text — only show in the conversation that is actively streaming */}
            {chat.isStreaming && chat.streamingText && isActiveConvLoading && (
              <div className="message message-assistant">
                <div className="message-avatar"><div className="oc-logo">OC</div></div>
                <div className="message-content">
                  <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(chat.streamingText, false) }} />
                  <span className="streaming-cursor" />
                  {/* Fase invisível (raciocínio/tool args): sem isto o cursor fica
                      parado por MINUTOS em modelos de raciocínio e o usuário acha
                      que travou. O contador subindo é o sinal de vida. */}
                  {chat.streamingPhase && (
                    <div className="streaming-phase">
                      <BrainCircuit size={11} className="pulse" /> {streamPhaseLabel(chat.streamingPhase)}
                    </div>
                  )}
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
                    <ThinkingTimer suppressHint={!!chat.runningTool || !!chat.streamingPhase} />
                    {/* Raciocínio ANTES do primeiro token visível cai neste branch
                        (isStreaming, mas streamingText ainda vazio). */}
                    {chat.streamingPhase && (
                      <span className="streaming-phase">
                        <BrainCircuit size={11} className="pulse" /> {streamPhaseLabel(chat.streamingPhase)}
                      </span>
                    )}
                    {chat.runningTool && (
                      <span className="running-tool" title={chat.runningTool.detail}>
                        <Wrench size={10} /> {chat.runningTool.name}{chat.runningTool.detail ? <span className="running-tool-detail"> · {chat.runningTool.detail}</span> : null}
                      </span>
                    )}
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

          {/* Jump to bottom — appears when scrolled up; pulses while the
              turn streams below the fold (v2.12.71) */}
          {showJumpBtn && activeConv && activeConv.messages.length > 0 && (
            <button
              className={`jump-to-bottom ${isActiveConvLoading ? 'streaming' : ''}`}
              onClick={() => {
                isNearBottomRef.current = true
                setShowJumpBtn(false)
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
              }}
              title={settings.language === 'en' ? 'Jump to latest' : 'Ir para o fim'}
            >
              <ArrowDown size={14} />
              {isActiveConvLoading && <span>{settings.language === 'en' ? 'New activity' : 'Atividade nova'}</span>}
            </button>
          )}

          {/* Task Plan Panel — checklist estilo Claude (estados claros + progresso) */}
          {activeConv?.taskPlan && (() => {
            const tasks = activeConv.taskPlan.tasks
            const total = tasks.length
            const doneCount = tasks.filter(t => t.status === 'done').length
            const pct = total ? Math.round((doneCount / total) * 100) : 0
            const current = tasks.find(t => t.status === 'in_progress')
            const allDone = total > 0 && doneCount === total
            return (
              <div className={`task-plan-panel ${taskPlanCollapsed ? 'collapsed' : ''} ${allDone ? 'is-complete' : ''}`}>
                <div
                  className="task-plan-header"
                  onClick={() => setTaskPlanCollapsed(c => !c)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title={taskPlanCollapsed ? 'Expandir' : 'Minimizar'}
                >
                  <ChevronDown
                    className="task-plan-chevron"
                    size={14}
                    style={{ transform: taskPlanCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                  />
                  <span className="task-plan-title">
                    <ListChecks size={14} /><span className="task-plan-goal">{activeConv.taskPlan.goal}</span>
                  </span>
                  <span className="task-plan-progress">{doneCount}/{total}</span>
                  <button
                    className="task-plan-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      convManager.setConversations(prev => prev.map(c =>
                        c.id === activeConv.id ? { ...c, taskPlan: undefined } : c
                      ))
                    }}
                    title="Fechar plano"
                    aria-label="Fechar plano"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="task-plan-bar"><div className="task-plan-bar-fill" style={{ width: `${pct}%` }} /></div>
                {taskPlanCollapsed && current && (
                  <div className="task-plan-current"><Loader2 size={12} className="spin" /><span>{current.title}</span></div>
                )}
                <div className="task-plan-list" aria-hidden={taskPlanCollapsed}>
                  {tasks.map(task => (
                    <div key={task.id} className={`task-plan-item is-${task.status}`}>
                      {task.status === 'done' ? <CheckCircle2 size={14} /> :
                       task.status === 'in_progress' ? <Loader2 size={14} className="spin" /> :
                       task.status === 'failed' ? <AlertCircle size={14} /> : <Circle size={14} />}
                      <span className="task-plan-item-title">{task.title}</span>
                      {task.result && <span className="task-result">{task.result}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

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
                {activeConv && (
                  <EffortSlider
                    value={activeConv.reasoningEffort}
                    globalDefault={settings.reasoningEffort ?? 'default'}
                    language={settings.language}
                    onChange={(v) => convManager.setConversations(prev => prev.map(c =>
                      c.id === activeConv.id ? { ...c, reasoningEffort: v } : c
                    ))}
                  />
                )}
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
              {queuedMessage && (
                <div className="queued-pill">
                  <Clock size={11} />
                  <span className="queued-pill-text">{settings.language === 'en' ? 'Queued: ' : 'Na fila: '}{queuedMessage.text.length > 90 ? queuedMessage.text.slice(0, 89) + '…' : queuedMessage.text}</span>
                  <button className="queued-pill-cancel" title={settings.language === 'en' ? 'Cancel (back to composer)' : 'Cancelar (volta ao campo)'}
                    onClick={() => { setInput(queuedMessage.text); setQueuedMessage(null); textareaRef.current?.focus() }}>
                    <X size={11} />
                  </button>
                </div>
              )}
              <div className="input-pill" onClick={e => e.stopPropagation()}>
                <div className="input-left-actions">
                  <button className="input-icon-btn" onClick={() => setShowCommandPalette(true)} title="Ferramentas e recursos (Ctrl+K)"><Plus size={18} /></button>
                </div>
                <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={isActiveConvLoading ? (settings.language === 'en' ? 'Type the next message — Enter queues it' : 'Digite a próxima mensagem — Enter coloca na fila') : PLACEHOLDER_HINTS[placeholderIdx]} className="message-input" rows={1} />
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
