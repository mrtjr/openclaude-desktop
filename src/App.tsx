import { useState, useEffect, useRef, useCallback } from 'react'
import 'highlight.js/styles/github-dark.css'
import { Send, Plus, Trash2, Minus, Square, X, Bot, User, Loader2, ChevronDown, Wrench, Terminal, Search, Settings as SettingsIcon, Download, FileText, XCircle, MessageSquare, Play, Code, Globe, FileCode, Info, ArrowUpCircle, Zap, BotOff, Copy, RefreshCw, Pin, PanelLeftClose, PanelLeft, Sun, Moon, Image, Trash, Mic, MicOff, Volume2, ListChecks, CheckCircle2, Circle, AlertCircle, Clock, BarChart3, Scale, Camera, Database, BookMarked, Swords, FolderOpen, GitBranch, Monitor, UserCog } from 'lucide-react'
import SettingsModal, { loadSettings, type AppSettings } from './Settings'
import AnalyticsDashboard from './Analytics'
import ParliamentMode from './Parliament'
import PromptVault from './PromptVault'
import PersonaEngine, { type Persona } from './PersonaEngine'
import ModelArena from './ModelArena'
import CodeWorkspace from './CodeWorkspace'
import VisionMode from './VisionMode'
import RAGPanel from './RAGPanel'
import ORION from './ORION'
import WorkflowBuilder from './WorkflowBuilder'
import CommandPalette from './components/CommandPalette'

// ─── Extracted modules ──────────────────────────────────────────────
import type { Message, ToolCall, ToolResult, Conversation, TaskPlan, PendingApproval, Toast } from './types'
import { TOOLS, SAFE_TOOLS, DANGEROUS_TOOLS, AGENT_SAFETY_LIMIT, NORMAL_SAFETY_LIMIT, IDLE_STEP_THRESHOLD } from './constants/tools'
import { AGENT_SYSTEM_PROMPT, PLANNING_MODE_PROMPT, LANGUAGE_RULE, LANGUAGE_PRIMING, LANGUAGE_REMINDER, PLACEHOLDER_HINTS, SUGGESTIONS } from './constants/prompts'
import { formatMarkdown, generateId, isSmallModel, getRelativeTime } from './utils/formatting'

// ─── Toast notification system ──────────────────────────────────
let toastId = 0
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((message: string) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])
  return { toasts, show }
}

// Types, tools, prompts, and utils imported from extracted modules above

// ─── App ─────────────────────────────────────────────────────────────
export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('openclaude-model') || 'qwen35-uncensored')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [ollamaOnline, setOllamaOnline] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set())
  const [updateAvailable, setUpdateAvailable] = useState<{available: boolean, releaseUrl: string, latestVersion: string} | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('openclaude-theme') as 'dark' | 'light') || 'dark')
  const [pinnedConvs, setPinnedConvs] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('openclaude-pinned') || '[]')) } catch { return new Set() }
  })
  const [isAgentMode, setIsAgentMode] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showParliament, setShowParliament] = useState(false)
  // ── v1.8.0 feature states ────────────────────────────────────────────────
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
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [showPermissionMenu, setShowPermissionMenu] = useState(false)
  const [showFeatureMenu, setShowFeatureMenu] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const recognitionRef = useRef<any>(null)
  const [agentSteps, setAgentSteps] = useState(0)
  const stopRequestedRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  const isNearBottomRef = useRef(true)
  const { toasts, show: showToast } = useToast()

  const activeConv = conversations.find(c => c.id === activeConvId)

  // ─── Load conversations from disk ──────────────────────────────
  useEffect(() => {
    setLoadingConversations(true)
    window.electron.loadConversations().then((data: any) => {
      if (Array.isArray(data) && data.length > 0) {
        const parsed = data.map((c: any) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          messages: c.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        }))
        setConversations(parsed)
        setActiveConvId(parsed[0].id)
      } else {
        newConversation()
      }
    }).catch(() => {
      newConversation()
    }).finally(() => {
      setLoadingConversations(false)
    })
  }, [])

  // ─── Save conversations with debounce (1s) ─────────────────────
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (conversations.length > 0) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        window.electron.saveConversations(conversations).catch(() => {})
      }, 1000)
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [conversations])

  // ─── Check for updates ─────────────────────────────────────────
  useEffect(() => {
    if (window.electron.checkForUpdates) {
      window.electron.checkForUpdates().then((res: any) => {
        if (res?.updateAvailable) {
          setUpdateAvailable({ available: true, releaseUrl: res.releaseUrl, latestVersion: res.latestVersion })
        }
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
        if (saved && names.includes(saved)) {
          setSelectedModel(saved)
        } else if (names.length > 0) {
          setSelectedModel(names[0])
          localStorage.setItem('openclaude-model', names[0])
        }
      }
    })
  }, [])

  // ─── Check Ollama status every 10s ─────────────────────────────
  useEffect(() => {
    const check = () => {
      window.electron.checkOllamaStatus().then(setOllamaOnline).catch(() => setOllamaOnline(false))
    }
    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [])

  // ─── Smart scroll: only auto-scroll if user is near the bottom ─
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
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [activeConv?.messages, streamingText])

  // ─── Auto resize textarea ─────────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  // ─── Rotating placeholder ───────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIdx(i => (i + 1) % PLACEHOLDER_HINTS.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  // ─── Theme management ──────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('openclaude-theme', theme)
  }, [theme])

  // ─── Code block copy buttons (event delegation) ────────────────
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
      // Escape: close modals
      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        if (showModelDropdown) setShowModelDropdown(false)
        if (showPermissionMenu) setShowPermissionMenu(false)
      }
      // Ctrl+N: new conversation
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        newConversation()
      }
      // Ctrl+K: open command palette
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(v => !v)
      }
      // Ctrl+,: open settings
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
      // Ctrl+Shift+V: Vision Mode
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault()
        setShowVision(true)
      }
      // Ctrl+P: Persona Engine
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault()
        setShowPersona(true)
      }
    }
    window.addEventListener('keydown', handleGlobalKeys)
    return () => window.removeEventListener('keydown', handleGlobalKeys)
  }, [showSettings, showModelDropdown])

  // ─── Drag & Drop ──────────────────────────────────────────────
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(true)
    }
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
    }
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)

      if (e.dataTransfer?.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i]
          const filePath = (file as any).path
          if (filePath) {
            try {
              const result = await window.electron.readDroppedFile(filePath)
              if (result.content) {
                const fileInfo = `[Arquivo: ${result.name || filePath}]\n\`\`\`\n${result.content.slice(0, 5000)}\n\`\`\`\n`
                setInput(prev => prev + fileInfo)
              } else if (result.error) {
                setInput(prev => prev + `[Erro ao ler ${filePath}: ${result.error}]`)
              }
            } catch {
              setInput(prev => prev + `[Erro ao ler ${filePath}]`)
            }
          }
        }
      }
    }

    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  // ─── Conversation management ───────────────────────────────────
  const newConversation = useCallback(() => {
    const conv: Conversation = {
      id: generateId(),
      title: 'Nova conversa',
      messages: [],
      createdAt: new Date()
    }
    setConversations(prev => [conv, ...prev])
    setActiveConvId(conv.id)
  }, [])

  const deleteConversation = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeConvId === id) {
      const remaining = conversations.filter(c => c.id !== id)
      if (remaining.length > 0) setActiveConvId(remaining[0].id)
      else newConversation()
    }
  }

  // ─── Tool execution ────────────────────────────────────────────
  const executeToolRaw = async (name: string, args: Record<string, any>): Promise<string> => {
    try {
      if (name === 'execute_command') {
        const result = await window.electron.execCommand(args.command)
        return result.stdout || result.stderr || result.error || 'Comando executado'
      }
      if (name === 'read_file') {
        const result = await window.electron.readFile(args.path)
        return result.content || result.error || ''
      }
      if (name === 'write_file') {
        const result = await window.electron.writeFile({ filePath: args.path, content: args.content })
        return result.error ? `Erro: ${result.error}` : 'Arquivo escrito com sucesso'
      }
      if (name === 'web_search') {
        const result = await window.electron.webSearch(args.query)
        return result.result || result.error || 'Sem resultados'
      }
      if (name === 'list_directory') {
        const result = await window.electron.listDirectory(args.path)
        if (result.items) {
          return result.items.map((item: any) =>
            `${item.type === 'directory' ? '[DIR]' : '[FILE]'} ${item.name} (${item.size} bytes, ${item.modified})`
          ).join('\n')
        }
        return result.error || 'Erro ao listar diretorio'
      }
      if (name === 'open_file_or_url') {
        const result = await window.electron.openTarget(args.target)
        return result.error ? `Erro: ${result.error}` : `Aberto: ${args.target}`
      }
      // ── Git ──
      if (name === 'git_command') {
        const result = await window.electron.gitCommand({ command: args.command, cwd: args.cwd })
        if (result.error) return `Git error: ${result.error}`
        return (result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim() || 'Done (no output)'
      }
      // ── Undo ──
      if (name === 'undo_last_write') {
        const result = await window.electron.undoLastWrite()
        return result.error ? `Undo error: ${result.error}` : `File restored: ${result.restored}`
      }
      // ── Task Planning ──
      if (name === 'plan_tasks') {
        const plan: TaskPlan = { goal: args.goal, tasks: args.tasks || [] }
        if (activeConvId) {
          setConversations(prev => prev.map(c => c.id !== activeConvId ? c : { ...c, taskPlan: plan }))
        }
        return `Task plan created: "${args.goal}" with ${plan.tasks.length} subtasks.`
      }
      if (name === 'update_task_status') {
        if (activeConvId) {
          setConversations(prev => prev.map(c => {
            if (c.id !== activeConvId || !c.taskPlan) return c
            const tasks = c.taskPlan.tasks.map(t =>
              t.id === args.task_id ? { ...t, status: args.status, result: args.result || t.result } : t
            )
            return { ...c, taskPlan: { ...c.taskPlan, tasks } }
          }))
        }
        return `Task "${args.task_id}" updated to ${args.status}${args.result ? ': ' + args.result : ''}`
      }
      // ── Browser Automation ──
      if (name === 'browser_navigate') {
        const launch = await window.electron.browserLaunch()
        if (launch.error) return `Browser launch error: ${launch.error}`
        const nav = await window.electron.browserNavigate(args.url)
        if (nav.error) return `Navigation error: ${nav.error}`
        const text = await window.electron.browserGetText()
        return `Navigated to: ${nav.title} (${nav.url})\n\nPage content:\n${text.text || '(empty)'}`
      }
      if (name === 'browser_get_text') {
        const result = await window.electron.browserGetText()
        return result.text || result.error || '(empty page)'
      }
      if (name === 'browser_click') {
        const result = await window.electron.browserClick(args.selector)
        return result.success ? `Clicked: ${args.selector}` : `Click error: ${result.error}`
      }
      if (name === 'browser_type') {
        const result = await window.electron.browserType({ selector: args.selector, text: args.text })
        return result.success ? `Typed in: ${args.selector}` : `Type error: ${result.error}`
      }
      // ── Collaborative Agents ──
      if (name === 'delegate_subtasks') {
        const lang = settings.language || 'pt'
        const systemMsg = settings.systemPrompt || ''
        const tasks = (args.subtasks || []).map((st: any) => ({
          id: st.id,
          messages: [
            ...(systemMsg ? [{ role: 'system', content: systemMsg + LANGUAGE_RULE[lang] }] : []),
            { role: 'user', content: st.prompt }
          ]
        }))
        const results = await window.electron.parallelChat({
          tasks,
          model: selectedModel,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens
        })
        return results.map((r: any) => {
          const content = r.result?.choices?.[0]?.message?.content || r.error || 'No response'
          return `[Agent ${r.id}]: ${content}`
        }).join('\n\n---\n\n')
      }
      return 'Ferramenta nao reconhecida'
    } catch (e: any) {
      return `Erro: ${e.message}`
    }
  }

  const requestApproval = (toolName: string, args: Record<string, any>): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingApproval({ toolName, args, resolve })
    })
  }

  const executeTool = async (name: string, args: Record<string, any>): Promise<string> => {
    // Permission check: dangerous tools require user approval (unless disabled by level)
    const level = settings.permissionLevel || 'ask'
    let needsApproval = false

    if (level === 'ask') {
      needsApproval = DANGEROUS_TOOLS.has(name)
    } else if (level === 'auto_edits') {
      // Auto-approve write/git, but ask for others
      const editTools = new Set(['write_file', 'git_command', 'undo_last_write'])
      needsApproval = DANGEROUS_TOOLS.has(name) && !editTools.has(name)
    } else if (level === 'planning') {
      needsApproval = DANGEROUS_TOOLS.has(name)
    } else if (level === 'ignore') {
      needsApproval = false
    }

    if (needsApproval) {
      const approved = await requestApproval(name, args)
      if (!approved) {
        // Audit: log denied action
        window.electron.auditLogAppend({ tool: name, args, status: 'denied', output: '' }).catch(() => {})
        return `[USER DENIED]: The user rejected execution of "${name}". Try a different approach or ask the user what they prefer.`
      }
    }

    const startTime = Date.now()
    const out = await executeToolRaw(name, args)
    const duration = Date.now() - startTime

    // Audit log: silently record every tool execution
    window.electron.auditLogAppend({
      tool: name,
      args,
      status: out.startsWith('Erro:') || out.startsWith('[SYSTEM INTERCEPT]') ? 'error' : 'success',
      output: out.substring(0, 500),
      duration,
      conversationId: activeConvId,
    }).catch(() => {})

    if (out && out.length > 4000) {
      return out.substring(0, 2000) +
      `\n\n...[SYSTEM TRUNCATED: Output too large. Original size was ${out.length} characters. Showing start and end only.]...\n\n` +
      out.substring(out.length - 1500)
    }

    return out
  }

  // ─── Export conversation ───────────────────────────────────────
  const exportConversation = async () => {
    if (!activeConv) return
    const result = await window.electron.saveDialog({
      defaultName: `${activeConv.title.replace(/[^a-zA-Z0-9 ]/g, '_')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (!result.filePath) return

    let md = `# ${activeConv.title}\n\n`
    md += `Data: ${new Date(activeConv.createdAt).toLocaleString('pt-BR')}\n\n---\n\n`
    for (const msg of activeConv.messages) {
      if (msg.role === 'user') {
        md += `## Usuario\n\n${msg.content}\n\n`
      } else if (msg.role === 'assistant') {
        md += `## Assistente\n\n${msg.content}\n\n`
        if (msg.toolCalls) {
          for (let i = 0; i < msg.toolCalls.length; i++) {
            const tc = msg.toolCalls[i]
            md += `### Ferramenta: ${tc.name}\n\n\`\`\`json\n${JSON.stringify(tc.arguments, null, 2)}\n\`\`\`\n\n`
            if (msg.toolResults?.[i]) {
              md += `**Resultado:**\n\`\`\`\n${msg.toolResults[i].result}\n\`\`\`\n\n`
            }
          }
        }
      }
    }

    await window.electron.writeFile({ filePath: result.filePath, content: md })
    showToast('Conversa exportada com sucesso!')
  }

  // ─── Voice I/O ─────────────────────────────────────────────────
  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      showToast('Speech Recognition not supported')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = settings.language === 'en' ? 'en-US' : 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setInput(prev => {
        // Replace interim results
        const base = prev.replace(/\[.*?\]$/, '').trimEnd()
        if (event.results[event.results.length - 1].isFinal) {
          return (base ? base + ' ' : '') + transcript
        }
        return (base ? base + ' ' : '') + `[${transcript}]`
      })
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  const speakText = (text: string) => {
    if (!ttsEnabled) return
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.replace(/[#*`_\[\]]/g, '').substring(0, 2000))
    utterance.lang = settings.language === 'en' ? 'en-US' : 'pt-BR'
    utterance.rate = 1.1
    speechSynthesis.speak(utterance)
  }

  const stopAgent = () => {
    stopRequestedRef.current = true
    setIsLoading(false)
    setIsStreaming(false)
    if (streamCleanupRef.current) {
      streamCleanupRef.current()
      streamCleanupRef.current = null
    }
    window.electron.abortStream().catch(() => {})
    showToast('Agente interrompido pelo usuário.')
  }

  // ─── Copy message text ────────────────────────────────────────
  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content)
    showToast('Mensagem copiada!')
  }

  // ─── Delete individual message ────────────────────────────────
  const deleteMessage = (msgId: string) => {
    if (!activeConvId) return
    setConversations(prev => prev.map(c => {
      if (c.id !== activeConvId) return c
      return { ...c, messages: c.messages.filter(m => m.id !== msgId) }
    }))
  }

  // ─── Regenerate last assistant response ───────────────────────
  const regenerateResponse = () => {
    if (!activeConv || isLoading) return
    const msgs = activeConv.messages
    // Find last user message
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx === -1) return
    const lastUserContent = msgs[lastUserIdx].content
    // Remove messages after (and including) the last assistant response
    const trimmed = msgs.slice(0, lastUserIdx + 1)
    // Remove last user msg too (sendMessage will re-add it)
    setConversations(prev => prev.map(c => {
      if (c.id !== activeConvId) return c
      return { ...c, messages: trimmed.slice(0, -1) }
    }))
    setInput(lastUserContent)
    // Trigger send on next tick
    setTimeout(() => {
      const btn = document.querySelector('.send-btn') as HTMLButtonElement
      btn?.click()
    }, 100)
  }

  // ─── Toggle conversation pin ──────────────────────────────────
  const togglePin = (convId: string) => {
    setPinnedConvs(prev => {
      const next = new Set(prev)
      if (next.has(convId)) next.delete(convId)
      else next.add(convId)
      localStorage.setItem('openclaude-pinned', JSON.stringify([...next]))
      return next
    })
  }

  // ─── Send message (with streaming support) ─────────────────────
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading || !activeConvId) return

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    setConversations(prev => prev.map(c => {
      if (c.id !== activeConvId) return c
      const messages = [...c.messages, userMsg]
      return {
        ...c,
        title: c.messages.length === 0 ? input.trim().slice(0, 40) : c.title,
        messages
      }
    }))

    setInput('')
      setIsLoading(true)
      setAgentSteps(0)
      stopRequestedRef.current = false

      // ─── MCD: Silent session analytics tracker ──────────────
      const sessionTracker = {
        startTime: Date.now(),
        toolCalls: 0,
        errors: 0,
        circuitBreaks: 0,
        toolsUsed: {} as Record<string, number>,
        agentMode: isAgentMode,
        agentSteps: 0,
        agentCompleted: false,
        model: selectedModel,
        provider: settings.provider,
        responseTimes: [] as number[],
      }

      try {
        const conv = conversationsRef.current.find(c => c.id === activeConvId)
        const lang = settings.language || 'pt'

        let finalProvider = settings.provider || 'ollama'
        let finalModel = selectedModel
        let finalApiKey = ''
        if (finalProvider === 'anthropic') {
           finalModel = settings.anthropicModel || 'claude-sonnet-4-20250514'
           finalApiKey = settings.anthropicApiKey
        } else if (finalProvider === 'openai') {
           finalModel = settings.openaiModel || 'gpt-4o'
           finalApiKey = settings.openaiApiKey
        } else if (finalProvider === 'gemini') {
           finalModel = settings.geminiModel || 'gemini-2.0-flash'
           finalApiKey = settings.geminiApiKey
        } else if (finalProvider === 'openrouter') {
           finalModel = settings.openrouterModel || 'google/gemini-2.5-pro'
           finalApiKey = settings.openrouterApiKey
        } else if (finalProvider === 'modal') {
           finalModel = settings.modalModel || 'zai-org/GLM-5.1-FP8'
           finalApiKey = settings.modalApiKey
        }
        const isNotOllama = finalProvider !== 'ollama'

        let systemPrompt = settings.systemPrompt || ''
        if (isAgentMode) {
          systemPrompt = AGENT_SYSTEM_PROMPT[lang] + (systemPrompt ? (lang === 'pt' ? "\n\nInstruções Adicionais:\n" : "\n\nAdditional Instructions:\n") + systemPrompt : "")
        }
        // Inject mandatory language rule
        systemPrompt += LANGUAGE_RULE[lang]

        const systemMessages: any[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
        
        // Reconstrói o histórico no formato esperado pela API (OpenAI/Ollama)
        const history: any[] = []
        if (conv) {
          for (const m of conv.messages) {
            history.push({
              role: m.role,
              content: m.content,
              ...(m.toolCalls ? { tool_calls: m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
              })) } : {})
            })
            // Se houver resultados de ferramentas, eles devem ser mensagens separadas com role 'tool'
            if (m.toolResults) {
              for (const tr of m.toolResults) {
                history.push({
                  role: 'tool',
                  tool_call_id: tr.toolCallId,
                  content: tr.result
                })
              }
            }
          }
        }
        // Adiciona a mensagem atual do usuário
        history.push({ role: 'user', content: userMsg.content })

        // Smart context management: compact old messages instead of discarding
        const MAX_CONTEXT_MESSAGES = settings.contextLimit || 50
        const COMPACT_THRESHOLD = Math.floor(MAX_CONTEXT_MESSAGES * 0.7)
        let contextSummary = conv?.contextSummary || ''
        let trimmedHistory = history

        if (history.length > MAX_CONTEXT_MESSAGES) {
          const overflow = history.length - COMPACT_THRESHOLD
          const oldMessages = history.slice(0, overflow)
          trimmedHistory = history.slice(overflow)

          // Request compaction from the model (async, non-blocking fallback)
          try {
            const compactResult = await window.electron.compactContext({
              messages: oldMessages,
              model: finalModel,
              language: lang
            })
            if (compactResult.summary) {
              contextSummary = (contextSummary ? contextSummary + '\n\n' : '') + compactResult.summary
              // Keep summary from growing unbounded (max ~2000 chars)
              if (contextSummary.length > 2000) {
                contextSummary = contextSummary.slice(-2000)
              }
              // Persist the summary on the conversation
              setConversations(prev => prev.map(c =>
                c.id !== activeConvId ? c : { ...c, contextSummary }
              ))
            }
          } catch {
            // Fallback: simple truncation if compaction fails
          }
        }

        // Inject memory context: persistent memory + context summary
        const memoryContext: string[] = []
        if (contextSummary) {
          memoryContext.push(`[CONTEXT SUMMARY — earlier conversation]\n${contextSummary}`)
        }
        if (settings.memoryEnabled) {
          try {
            const mem = await window.electron.loadMemory()
            const parts: string[] = []
            if (mem.facts?.length) parts.push(`Facts: ${mem.facts.join('; ')}`)
            if (mem.preferences?.length) parts.push(`Preferences: ${mem.preferences.join('; ')}`)
            if (mem.projects?.length) parts.push(`Projects: ${mem.projects.join('; ')}`)
            if (parts.length > 0) {
              memoryContext.push(`[PERSISTENT MEMORY]\n${parts.join('\n')}`)
            }
          } catch {}
        }

        // Language priming: inject a fake Q&A exchange that locks the language
        const priming = LANGUAGE_PRIMING[lang]
        const primingMessages = [
          { role: 'user', content: priming.user },
          { role: 'assistant', content: priming.assistant }
        ]

        // Build context: system + memory + priming + history
        const memoryMessages = memoryContext.length > 0
          ? [{ role: 'system', content: memoryContext.join('\n\n') }]
          : []

        let continueLoop = true
        let allMessages: any[] = [...systemMessages, ...memoryMessages, ...primingMessages, ...trimmedHistory]
        // Cloud providers (OpenAI/OpenRouter/Modal/Anthropic) now support streaming via providerChatStream
        const cloudStreamingSupported = ['openai', 'openrouter', 'modal', 'anthropic'].includes(finalProvider)
        const useStreaming = isNotOllama ? (cloudStreamingSupported && settings.streamingEnabled) : settings.streamingEnabled
        let steps = 0
        let idleSteps = 0 // steps with no real tool execution (only memory updates, errors, etc.)
        const recentToolCalls: string[] = []
        let activeMemory = conv?.workingMemory || null
        const safetyLimit = isAgentMode ? AGENT_SAFETY_LIMIT : NORMAL_SAFETY_LIMIT

        while (continueLoop && steps < safetyLimit) {
          if (stopRequestedRef.current) break;
          steps++
          sessionTracker.agentSteps = steps
          setAgentSteps(steps)
          const stepStartTime = Date.now()
          
          const requestMessages = [...allMessages]
          if (activeMemory && isAgentMode) {
            requestMessages.push({
              role: 'system',
              content: `[URGENT WORKING MEMORY STATE]\nGoal: ${activeMemory.current_goal || 'None'}\nDone: ${activeMemory.done_steps || 'None'}\nPending: ${activeMemory.open_tasks || 'None'}`
            })
          }

          if (settings.permissionLevel === 'planning') {
            requestMessages.push({
              role: 'system',
              content: PLANNING_MODE_PROMPT[lang]
            })
          }

          if (isAgentMode && isSmallModel(finalModel)) {
            requestMessages.push({
              role: 'system',
              content: `[CRITICAL AGENT DIRECTIVE]\nYou are an autonomous Agent with unlimited steps. You MUST keep calling tools until the user's goal is 100% complete.\n- If the goal is NOT fully done, you MUST output a tool call. Do NOT output a text-only response.\n- Use 'update_working_memory' every few steps.\n- Only give a final text answer when every single subtask is done.\n- NEVER say "I'll do X next" — just DO it by calling the tool NOW.`
            })
          }

          // Language reminder: injected last = closest to generation = strongest influence
          requestMessages.push({
            role: 'system',
            content: LANGUAGE_REMINDER[lang]
          })

          if (useStreaming) {
            // ─── Streaming path ────────────────────────────────
            let accumulated = ''
          let toolCallsData: any[] = []
          let finishReason = ''
          setIsStreaming(true)
          setStreamingText('')

          await new Promise<void>((resolve, reject) => {
            const cleanup = window.electron.onStreamChunk((chunk: any) => {
              if (chunk.done) {
                cleanup()
                streamCleanupRef.current = null
                resolve()
                return
              }
              if (chunk.error) {
                cleanup()
                streamCleanupRef.current = null
                reject(new Error(chunk.error))
                return
              }
              const delta = chunk.choices?.[0]?.delta
              if (delta) {
                if (delta.content) {
                  accumulated += delta.content
                  setStreamingText(accumulated)
                }
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0
                    if (!toolCallsData[idx]) {
                      toolCallsData[idx] = { id: tc.id || '', function: { name: '', arguments: '' } }
                    }
                    if (tc.id) toolCallsData[idx].id = tc.id
                    if (tc.function?.name) toolCallsData[idx].function.name += tc.function.name
                    if (tc.function?.arguments) toolCallsData[idx].function.arguments += tc.function.arguments
                  }
                }
              }
              const fr = chunk.choices?.[0]?.finish_reason
              if (fr) finishReason = fr
            })
            streamCleanupRef.current = cleanup

            // Route to the correct streaming handler based on provider
            const streamCall = isNotOllama
              ? window.electron.providerChatStream({
                  provider: finalProvider,
                  apiKey: finalApiKey,
                  model: finalModel,
                  messages: requestMessages,
                  tools: TOOLS,
                  temperature: settings.temperature,
                  max_tokens: settings.maxTokens,
                  modalHostname: settings.modalHostname
                })
              : window.electron.ollamaChatStream({
                  model: finalModel,
                  messages: requestMessages,
                  tools: TOOLS,
                  temperature: settings.temperature,
                  max_tokens: settings.maxTokens
                })
            streamCall.catch((err: any) => {
              cleanup()
              streamCleanupRef.current = null
              reject(err)
            })
          })

          setIsStreaming(false)
          setStreamingText('')

          if (toolCallsData.length > 0 && toolCallsData[0]?.function?.name) {
            const thinkingMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content: accumulated,
              toolCalls: toolCallsData.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                arguments: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return { raw_invalid_json: tc.function.arguments } } })()
              })),
              timestamp: new Date()
            }

            const toolResults: ToolResult[] = []
            for (const tc of toolCallsData) {
              let args: Record<string, any> = {}
              let jsonError: string | null = null
              let result = ""
              const rawArgs = tc.function.arguments || '{}'
              
              try { 
                args = JSON.parse(rawArgs) 
              } catch (e: any) {
                jsonError = e.message
              }
              
              const callSignature = `${tc.function.name}:::${rawArgs}`

              if (jsonError) {
                result = `[SYSTEM INTERCEPT]: JSON Parse Error - ${jsonError}. You provided: ${rawArgs}. You MUST output strictly valid JSON syntax. Try calling the tool again with fixed JSON.`
                sessionTracker.errors++
              } else if (tc.function.name === 'update_working_memory') {
                activeMemory = args
                setConversations(prev => prev.map(c => c.id !== activeConvId ? c : { ...c, workingMemory: args }))
                result = `[SYSTEM]: Working memory updated successfully.`
              } else if (
                recentToolCalls.filter(c => c === callSignature).length >= 2
              ) {
                result = `[SYSTEM INTERCEPT]: Circuit Breaker Triggered. You already called "${tc.function.name}" with these exact arguments ${recentToolCalls.filter(c => c === callSignature).length} times. This approach is not working. You MUST try a completely different strategy, use a different tool, or give a final text response. Do NOT repeat this call.`
                sessionTracker.circuitBreaks++
              } else {
                result = await executeTool(tc.function.name, args)
              }

              // MCD: Track tool usage silently
              sessionTracker.toolCalls++
              sessionTracker.toolsUsed[tc.function.name] = (sessionTracker.toolsUsed[tc.function.name] || 0) + 1

              recentToolCalls.push(callSignature)
              toolResults.push({ toolCallId: tc.id, name: tc.function.name, result })
            }
            thinkingMsg.toolResults = toolResults

            // Track idle steps: if all tools in this step were non-productive, increment idle counter
            const hasRealToolWork = toolResults.some(tr =>
              tr.name !== 'update_working_memory' &&
              !tr.result.startsWith('[SYSTEM INTERCEPT]')
            )
            if (hasRealToolWork) { idleSteps = 0 } else { idleSteps++ }
            if (idleSteps >= IDLE_STEP_THRESHOLD) {
              continueLoop = false
            }

            setConversations(prev => prev.map(c =>
              c.id !== activeConvId ? c : { ...c, messages: [...c.messages, thinkingMsg] }
            ))

            allMessages = [
              ...allMessages,
              { role: 'assistant', content: accumulated, tool_calls: toolCallsData },
              ...toolResults.map(tr => ({
                role: 'tool',
                tool_call_id: tr.toolCallId,
                content: tr.result
              }))
            ]

          } else {
            const finalMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content: accumulated,
              timestamp: new Date()
            }
            setConversations(prev => prev.map(c =>
              c.id !== activeConvId ? c : { ...c, messages: [...c.messages, finalMsg] }
            ))
            if (accumulated) speakText(accumulated)
            sessionTracker.agentCompleted = true
            continueLoop = false
          }

          // Only stop on 'stop' if NO tool calls were made this step
          // Ollama local models often return finish_reason='stop' even after emitting tool_calls
          if (finishReason === 'stop' && !(toolCallsData.length > 0 && toolCallsData[0]?.function?.name)) {
            sessionTracker.agentCompleted = true
            continueLoop = false
          }

        } else {
          // ─── Non-streaming path ────────────────────────────
          let response: any
          if (isNotOllama) {
            response = await window.electron.providerChat({
              provider: finalProvider,
              apiKey: finalApiKey,
              model: finalModel,
              messages: requestMessages,
              tools: TOOLS,
              temperature: settings.temperature,
              max_tokens: settings.maxTokens,
              modalHostname: settings.modalHostname
            })
          } else {
            response = await window.electron.ollamaChat({
              model: finalModel,
              messages: requestMessages,
              tools: TOOLS,
              temperature: settings.temperature,
              max_tokens: settings.maxTokens
            })
          }

          if (response.error) {
             throw new Error(response.error)
          }

          const choice = response.choices?.[0]
          if (!choice) break

          const assistantMsg = choice.message
          const toolCalls = assistantMsg.tool_calls

          if (toolCalls && toolCalls.length > 0) {
            const thinkingMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content: assistantMsg.content || '',
              toolCalls: toolCalls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                  ? (() => { try { return JSON.parse(tc.function.arguments) } catch { return { raw_invalid_json: tc.function.arguments } } })()
                  : tc.function.arguments
              })),
              timestamp: new Date()
            }

            const toolResults: ToolResult[] = []
            for (const tc of toolCalls) {
              let args: Record<string, any> = {}
              let jsonError: string | null = null
              let result = ""

              if (typeof tc.function.arguments === 'string') {
                try {
                  args = JSON.parse(tc.function.arguments || '{}')
                } catch (e: any) {
                  jsonError = e.message
                }
              } else {
                args = tc.function.arguments || {}
              }

              const rawArgs = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {})
              const callSignature = `${tc.function.name}:::${rawArgs}`

              if (jsonError) {
                result = `[SYSTEM INTERCEPT]: JSON Parse Error - ${jsonError}. You provided: ${tc.function.arguments}. You MUST output strictly valid JSON syntax. Try calling the tool again with fixed JSON.`
                sessionTracker.errors++
              } else if (tc.function.name === 'update_working_memory') {
                activeMemory = args
                setConversations(prev => prev.map(c => c.id !== activeConvId ? c : { ...c, workingMemory: args }))
                result = `[SYSTEM]: Working memory updated successfully.`
              } else if (
                recentToolCalls.filter(c => c === callSignature).length >= 2
              ) {
                result = `[SYSTEM INTERCEPT]: Circuit Breaker Triggered. You already called "${tc.function.name}" with these exact arguments ${recentToolCalls.filter(c => c === callSignature).length} times. This approach is not working. You MUST try a completely different strategy, use a different tool, or give a final text response. Do NOT repeat this call.`
                sessionTracker.circuitBreaks++
              } else {
                result = await executeTool(tc.function.name, args)
              }

              // MCD: Track tool usage silently
              sessionTracker.toolCalls++
              sessionTracker.toolsUsed[tc.function.name] = (sessionTracker.toolsUsed[tc.function.name] || 0) + 1

              recentToolCalls.push(callSignature)
              toolResults.push({ toolCallId: tc.id, name: tc.function.name, result })
            }

            thinkingMsg.toolResults = toolResults

            // Track idle steps: if all tools in this step were non-productive, increment idle counter
            const hasRealToolWork = toolResults.some(tr =>
              tr.name !== 'update_working_memory' &&
              !tr.result.startsWith('[SYSTEM INTERCEPT]')
            )
            if (hasRealToolWork) { idleSteps = 0 } else { idleSteps++ }
            if (idleSteps >= IDLE_STEP_THRESHOLD) {
              continueLoop = false
            }

            setConversations(prev => prev.map(c =>
              c.id !== activeConvId ? c : { ...c, messages: [...c.messages, thinkingMsg] }
            ))

            allMessages = [
              ...allMessages,
              { role: 'assistant', content: assistantMsg.content || '', tool_calls: toolCalls },
              ...toolResults.map(tr => ({
                role: 'tool',
                tool_call_id: tr.toolCallId,
                content: tr.result
              }))
            ]

          } else {
            const finalMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content: assistantMsg.content || '',
              timestamp: new Date()
            }
            setConversations(prev => prev.map(c =>
              c.id !== activeConvId ? c : { ...c, messages: [...c.messages, finalMsg] }
            ))
            if (assistantMsg.content) speakText(assistantMsg.content)
            sessionTracker.agentCompleted = true
            continueLoop = false
          }

          // Only stop on 'stop' if NO tool calls were made this step
          if (choice.finish_reason === 'stop' && !(toolCalls && toolCalls.length > 0)) {
            sessionTracker.agentCompleted = true
            continueLoop = false
          }
        }

          // MCD: Track response time per step
          sessionTracker.responseTimes.push(Date.now() - stepStartTime)
      }
    } catch (e: any) {
      sessionTracker.errors++
      setIsStreaming(false)
      setStreamingText('')
      const errMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: `Erro: ${e.message}`,
        timestamp: new Date()
      }
      setConversations(prev => prev.map(c =>
        c.id !== activeConvId ? c : { ...c, messages: [...c.messages, errMsg] }
      ))
    } finally {
      setIsLoading(false)
      setIsStreaming(false)
      setStreamingText('')

      // MCD/MASA: Save session analytics silently
      if (settings.analyticsEnabled !== false) {
        const avgRT = sessionTracker.responseTimes.length > 0
          ? Math.round(sessionTracker.responseTimes.reduce((a, b) => a + b, 0) / sessionTracker.responseTimes.length)
          : 0
        window.electron.analyticsSaveSession({
          toolCalls: sessionTracker.toolCalls,
          errors: sessionTracker.errors,
          circuitBreaks: sessionTracker.circuitBreaks,
          toolsUsed: Object.entries(sessionTracker.toolsUsed).map(([name, count]) => ({ name, count })),
          agentMode: sessionTracker.agentMode,
          agentSteps: sessionTracker.agentSteps,
          agentCompleted: sessionTracker.agentCompleted,
          model: sessionTracker.model,
          provider: sessionTracker.provider,
          avgResponseTime: avgRT,
          duration: Date.now() - sessionTracker.startTime,
        }).catch(() => {}) // Silent — never interrupt the user
      }
    }
  }, [input, isLoading, activeConvId, selectedModel, settings, isAgentMode])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ─── Filtered & sorted conversations (pinned first, with debounced search) ─
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 200)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery])

  const filteredConversations = (() => {
    let list = conversations
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      list = list.filter(c => c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q)))
    }
    // Pinned first
    return [...list].sort((a, b) => {
      const ap = pinnedConvs.has(a.id) ? 1 : 0
      const bp = pinnedConvs.has(b.id) ? 1 : 0
      return bp - ap
    })
  })()

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className={`app-container ${settings.permissionLevel === 'ignore' ? 'ignore-mode-active' : ''}`}>
      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast">{t.message}</div>
        ))}
      </div>

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
        isListening={isListening}
        onToggleListening={toggleListening}
        ttsEnabled={ttsEnabled}
        onToggleTTS={() => { setTtsEnabled(p => !p); if (ttsEnabled) speechSynthesis.cancel() }}
        onSetPermission={(level) => setSettings({ ...settings, permissionLevel: level })}
      />

      {/* Analytics Dashboard (MAGI) */}
      <AnalyticsDashboard
        isOpen={showAnalytics}
        onClose={() => setShowAnalytics(false)}
        language={settings.language}
      />

      {/* Parliament Mode — Multi-Agent Debate */}
      {showParliament && (
        <ParliamentMode
          settings={settings}
          ollamaModels={models}
          onClose={() => setShowParliament(false)}
          onInsertToChat={(text) => {
            setInput(prev => (prev ? prev + '\n\n' : '') + text)
            setShowParliament(false)
          }}
        />
      )}

      {/* ─── v1.8.0 Feature Modals ─────────────────────────────────── */}
      {showVault && (
        <PromptVault
          onClose={() => setShowVault(false)}
          onInsert={(text) => {
            setInput(prev => (prev ? prev + '\n\n' : '') + text)
            setShowVault(false)
          }}
        />
      )}

      {showPersona && (
        <PersonaEngine
          settings={settings}
          ollamaModels={models}
          activePersonaId={activePersonaId}
          onClose={() => setShowPersona(false)}
          onActivatePersona={(persona) => {
            setActivePersona(persona)
            setActivePersonaId(persona?.id ?? null)
          }}
        />
      )}

      {showArena && (
        <ModelArena
          settings={settings}
          ollamaModels={models}
          onClose={() => setShowArena(false)}
        />
      )}

      {showCodeWorkspace && (
        <CodeWorkspace
          settings={settings}
          ollamaModels={models}
          onClose={() => setShowCodeWorkspace(false)}
          onInsertToChat={(text) => {
            setInput(prev => (prev ? prev + '\n\n' : '') + text)
            setShowCodeWorkspace(false)
          }}
        />
      )}

      {showVision && (
        <VisionMode
          settings={settings}
          ollamaModels={models}
          onClose={() => setShowVision(false)}
          onInsertToChat={(text) => {
            setInput(prev => (prev ? prev + '\n\n' : '') + text)
            setShowVision(false)
          }}
        />
      )}

      {showRAG && (
        <RAGPanel
          settings={settings}
          ollamaModels={models}
          onClose={() => setShowRAG(false)}
          ragEnabled={ragEnabled}
          onToggleRAG={setRagEnabled}
        />
      )}

      {showWorkflow && (
        <WorkflowBuilder
          settings={settings}
          onClose={() => setShowWorkflow(false)}
          onInsertToChat={(text) => {
            setInput(prev => (prev ? prev + '\n\n' : '') + text)
            setShowWorkflow(false)
          }}
        />
      )}

      {showOrion && (
        <ORION
          settings={settings}
          onClose={() => setShowOrion(false)}
        />
      )}

      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-drag">
          <div className="titlebar-logo">
            <div className="oc-logo-small">OC</div>
            <span>OpenClaude Desktop</span>
          </div>
          {/* Ollama status indicator */}
          <div className={`ollama-status ${ollamaOnline ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            <span className="status-text">{ollamaOnline ? 'Ollama Online' : 'Ollama Offline'}</span>
          </div>
        </div>
        <div className="titlebar-center">
          {activeConv ? activeConv.title : ''}
        </div>
        <div className="titlebar-actions">
          <button className="titlebar-action-btn" onClick={() => setSidebarOpen(p => !p)} title="Toggle sidebar">
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
          </button>
          <button className="titlebar-action-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Alternar tema">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          {activeConv && activeConv.messages.length > 0 && (
            <>
              <button className="titlebar-action-btn" onClick={regenerateResponse} title="Regenerar última resposta" disabled={isLoading}>
                <RefreshCw size={14} />
              </button>
              <button className="titlebar-action-btn export-btn" onClick={exportConversation} title="Exportar conversa">
                <Download size={14} />
                <span>Exportar</span>
              </button>
            </>
          )}
          <button className="titlebar-action-btn" onClick={() => setShowAnalytics(true)} title="Analytics & Insights">
            <BarChart3 size={14} />
          </button>
          <button className="titlebar-action-btn" onClick={() => setShowSettings(true)} title="Configurações (Ctrl+,)">
            <SettingsIcon size={14} />
          </button>
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
          <button className="update-download-btn" onClick={() => window.electron.openTarget(updateAvailable.releaseUrl)}>
            Baixar
          </button>
          <button className="update-close-btn" onClick={() => setUpdateAvailable(null)}>
            X
          </button>
        </div>
      )}

      <div className="main-layout">
        {/* Sidebar */}
        <div className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
          <div className="sidebar-header">
            <button className="new-chat-btn" onClick={newConversation}>
              <Plus size={16} /> Nova conversa
            </button>
            {/* Search */}
            <div className="search-container">
              <Search size={14} className="search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar conversas... (Ctrl+K)"
                className="search-input"
              />
            </div>
          </div>

          <div className="conversations-list">
            {loadingConversations ? (
              <>
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="conv-item skeleton">
                    <div className="skeleton-bar" />
                  </div>
                ))}
              </>
            ) : (
              filteredConversations.map(conv => (
                <div
                  key={conv.id}
                  className={`conv-item ${conv.id === activeConvId ? 'active' : ''} ${pinnedConvs.has(conv.id) ? 'pinned' : ''}`}
                  onClick={() => setActiveConvId(conv.id)}
                >
                  {pinnedConvs.has(conv.id) ? <Pin size={14} className="conv-icon pinned-icon" /> : <MessageSquare size={14} className="conv-icon" />}
                  <div className="conv-info">
                    <span className="conv-title">{conv.title}</span>
                    <span className="conv-date">{getRelativeTime(conv.createdAt)}</span>
                  </div>
                  <div className="conv-actions">
                    <button className="conv-action-btn" onClick={(e) => { e.stopPropagation(); togglePin(conv.id) }} title={pinnedConvs.has(conv.id) ? 'Desafixar' : 'Fixar'}>
                      <Pin size={12} />
                    </button>
                    <button className="conv-action-btn conv-delete" onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}>
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
                  <span className="model-name" style={{ textTransform: 'capitalize' }}>
                    {settings.provider}: {
                      settings.provider === 'anthropic' ? settings.anthropicModel :
                      settings.provider === 'openai' ? settings.openaiModel :
                      settings.provider === 'openrouter' ? settings.openrouterModel :
                      settings.provider === 'modal' ? settings.modalModel :
                      settings.geminiModel
                    }
                  </span>
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
                <p>Modelo atual: <strong>
                  {settings.provider === 'ollama' ? selectedModel : 
                   settings.provider === 'anthropic' ? settings.anthropicModel :
                   settings.provider === 'openai' ? settings.openaiModel :
                   settings.provider === 'openrouter' ? settings.openrouterModel :
                   settings.provider === 'modal' ? settings.modalModel :
                   settings.geminiModel}
                </strong> via <span style={{ textTransform: 'capitalize' }}>{settings.provider}</span></p>
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
                    {msg.content && (
                      <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
                    )}
                    {msg.toolCalls && msg.toolCalls.map((tc, i) => {
                      const toolKey = `${msg.id}-${i}`
                      const resultText = msg.toolResults?.[i]?.result || ''
                      const defaultCollapsed = resultText.length > 200
                      const isCollapsed = collapsedTools.has(toolKey) ? !defaultCollapsed : defaultCollapsed
                      
                      const toggleCollapse = () => {
                        const newSet = new Set(collapsedTools)
                        if (newSet.has(toolKey)) newSet.delete(toolKey)
                        else newSet.add(toolKey)
                        setCollapsedTools(newSet)
                      }

                      return (
                        <div key={i} className="tool-call">
                          <button className="tool-call-header" onClick={toggleCollapse}>
                            {isCollapsed ? <Play size={10} className="tool-play" /> : <ChevronDown size={14} />}
                            <Wrench size={12} className="tool-icon" />
                            <span>{tc.name}</span>
                          </button>
                          {!isCollapsed && (
                            <>
                              <pre className="tool-call-args">{JSON.stringify(tc.arguments, null, 2)}</pre>
                              {msg.toolResults?.[i] && (
                                <div className="tool-result">
                                  <Terminal size={12} />
                                  <pre>{msg.toolResults[i].result}</pre>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                    <div className="message-footer">
                      <span className="message-timestamp">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="message-actions">
                        {msg.content && (
                          <button className="msg-action-btn" onClick={() => copyMessage(msg.content)} title="Copiar">
                            <Copy size={12} />
                          </button>
                        )}
                        <button className="msg-action-btn" onClick={() => deleteMessage(msg.id)} title="Excluir mensagem">
                          <Trash size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
            {/* Streaming text */}
            {isStreaming && streamingText && (
              <div className="message message-assistant">
                <div className="message-avatar"><div className="oc-logo">OC</div></div>
                <div className="message-content">
                  <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(streamingText) }} />
                  <span className="streaming-cursor" />
                </div>
              </div>
            )}
            {isLoading && (
              <div className="message message-assistant">
                <div className="message-avatar">
                  <div className={`oc-logo ${isAgentMode ? 'agent-active' : ''}`}>OC</div>
                </div>
                <div className="message-content">
                  <div className="agent-status-container">
                    <div className="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                    {isAgentMode && (
                      <div className="agent-badge">
                        <Zap size={10} className="pulse" />
                        <span>Agente: Passo {agentSteps}</span>
                      </div>
                    )}
                    {isLoading && (
                      <button className="stop-agent-btn" onClick={stopAgent} title="Interromper Agente">
                        <BotOff size={14} /> Parar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Task Plan Panel */}
          {activeConv?.taskPlan && (
            <div className="task-plan-panel">
              <div className="task-plan-header">
                <ListChecks size={14} />
                <span>{activeConv.taskPlan.goal}</span>
                <span className="task-plan-progress">
                  {activeConv.taskPlan.tasks.filter(t => t.status === 'done').length}/{activeConv.taskPlan.tasks.length}
                </span>
              </div>
              <div className="task-plan-list">
                {activeConv.taskPlan.tasks.map(task => (
                  <div key={task.id} className={`task-plan-item task-${task.status}`}>
                    {task.status === 'done' ? <CheckCircle2 size={12} /> :
                     task.status === 'in_progress' ? <Loader2 size={12} className="spin" /> :
                     task.status === 'failed' ? <AlertCircle size={12} /> :
                     <Circle size={12} />}
                    <span>{task.title}</span>
                    {task.result && <span className="task-result">{task.result}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool Approval Banner */}
          {pendingApproval && (
            <div className="approval-banner">
              <div className="approval-header">
                <AlertCircle size={16} />
                <span>{settings.language === 'en' ? 'Permission required' : 'Permissão necessária'}</span>
              </div>
              <div className="approval-detail">
                <span className="approval-tool">{pendingApproval.toolName}</span>
                <pre className="approval-args">{JSON.stringify(pendingApproval.args, null, 2)}</pre>
              </div>
              <div className="approval-actions">
                <button className="approval-btn approve" onClick={() => {
                  pendingApproval.resolve(true)
                  setPendingApproval(null)
                }}>
                  <CheckCircle2 size={14} /> {settings.language === 'en' ? 'Allow' : 'Permitir'}
                </button>
                <button className="approval-btn deny" onClick={() => {
                  pendingApproval.resolve(false)
                  setPendingApproval(null)
                }}>
                  <XCircle size={14} /> {settings.language === 'en' ? 'Deny' : 'Negar'}
                </button>
              </div>
            </div>
          )}

          {/* ── Input area v2.1: Clean pill design (Claude.ai + ChatGPT-inspired) ── */}
          <div className="input-area" onClick={() => showFeatureMenu && setShowFeatureMenu(false)}>
            <div className="input-wrapper">

              {/* Hidden image input */}
              <input type="file" id="image-upload" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  setInput(prev => prev + `\n[Imagem: ${file.name}]\n`)
                  showToast(`Imagem ${file.name} anexada`)
                }
                reader.readAsDataURL(file)
                e.target.value = ''
              }} />

              {/* Status pills (appear only when features are active — Manus AI pattern) */}
              {(isAgentMode || settings.permissionLevel === 'ignore' || activePersona || ragEnabled || isLoading) && (
                <div className="input-status-bar">
                  {isAgentMode && <span className="status-pill agent"><Zap size={9} />Agente{isLoading ? ` · Passo ${agentSteps}` : ''}</span>}
                  {settings.permissionLevel === 'ignore' && <span className="status-pill danger"><AlertCircle size={9} />Bypass Mode</span>}
                  {activePersona && <span className="status-pill persona"><UserCog size={9} />{activePersona.name}</span>}
                  {ragEnabled && <span className="status-pill rag"><Database size={9} />RAG</span>}
                  {isLoading && <button className="status-pill stop-pill" onClick={stopAgent}><Square size={9} />Parar</button>}
                </div>
              )}

              {/* Main pill input (Claude.ai style) */}
              <div className="input-pill" onClick={e => e.stopPropagation()}>

                {/* Left side: + button opens Command Palette */}
                <div className="input-left-actions">
                  <button
                    className="input-icon-btn"
                    onClick={() => setShowCommandPalette(true)}
                    title="Ferramentas e recursos (Ctrl+K)"
                  >
                    <Plus size={18} />
                  </button>
                </div>

                {/* Textarea — the star of the show */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={PLACEHOLDER_HINTS[placeholderIdx]}
                  className="message-input"
                  rows={1}
                  disabled={isLoading}
                />

                {/* Right side: clear + mode toggle + send */}
                <div className="input-right-actions">
                  {input.length > 0 && (
                    <button className="input-icon-btn" onClick={() => { setInput(''); textareaRef.current?.focus() }} title="Limpar">
                      <XCircle size={14} />
                    </button>
                  )}

                  {/* Agent toggle compact pill */}
                  <button
                    className={`mode-toggle ${isAgentMode ? 'agent-on' : ''}`}
                    onClick={() => setIsAgentMode(!isAgentMode)}
                    title={isAgentMode ? 'Chat normal' : 'Modo Agente autônomo'}
                  >
                    <Zap size={13} />
                    <span>{isAgentMode ? 'Agente' : 'Chat'}</span>
                  </button>

                  {/* Send/Stop circular button (ChatGPT style) */}
                  {isLoading ? (
                    <button className="send-circle stop" onClick={stopAgent} title="Parar">
                      <Square size={14} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className={`send-circle ${!input.trim() ? 'disabled' : ''}`}
                      onClick={sendMessage}
                      disabled={!input.trim()}
                      title="Enviar (Enter)"
                    >
                      <Send size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="input-footer">
                <p className="input-hint">Enter para enviar · Shift+Enter nova linha · Ctrl+N nova conversa · Ctrl+, config</p>
                {input.length > 50 && <span className="token-counter">{Math.ceil(input.length / 4)} tokens</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
