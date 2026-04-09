import { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/github-dark.css'
import { Send, Plus, Trash2, Minus, Square, X, Bot, User, Loader2, ChevronDown, Wrench, Terminal, Search, Settings as SettingsIcon, Download, FileText, XCircle, MessageSquare, Play, Code, Globe, FileCode, Info, ArrowUpCircle, Zap, BotOff, Copy, RefreshCw, Pin, PanelLeftClose, PanelLeft, Sun, Moon, Image, Trash, Mic, MicOff, Volume2, ListChecks, CheckCircle2, Circle, AlertCircle, Clock, BarChart3 } from 'lucide-react'
import SettingsModal, { loadSettings, loadAllCredentials, type AppSettings } from './Settings'
import AnalyticsDashboard from './Analytics'

// ─── Toast notification system ──────────────────────────────────
let toastId = 0
interface Toast { id: number; message: string }
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((message: string) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])
  return { toasts, show }
}

// ─── Rotating placeholder hints ─────────────────────────────────
const PLACEHOLDER_HINTS = [
  'Mensagem para OpenClaude... (Enter para enviar)',
  'Tente: "Crie um script Python..."',
  'Tente: "Liste os arquivos em D:\\"',
  'Tente: "Pesquise na web sobre IA"',
  'Tente: "Explique como funciona Ollama"',
  'Shift+Enter para nova linha',
]

const SUGGESTIONS = [
  { text: 'Crie um script Python', icon: Code },
  { text: 'Liste arquivos em D:\\', icon: FileCode },
  { text: 'Explique como funciona Ollama', icon: Info },
  { text: 'Pesquise na web sobre IA', icon: Globe }
]

const getRelativeTime = (d: Date) => {
  const diff = Math.floor((new Date().getTime() - new Date(d).getTime()) / 60000)
  if (diff < 1) return 'agora'
  if (diff < 60) return `há ${diff} min`
  if (diff < 1440) return `há ${Math.floor(diff/60)} h`
  return 'ontem'
}

// ─── Types ───────────────────────────────────────────────────────────
interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: Date
}

interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

interface ToolResult {
  toolCallId: string
  name: string
  result: string
  error?: string
}

interface TaskPlan {
  goal: string
  tasks: { id: string; title: string; status: string; result?: string }[]
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  workingMemory?: Record<string, string>
  taskPlan?: TaskPlan
  contextSummary?: string
}

// ─── Tools ───────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'update_working_memory',
      description: 'Update your short-term memory to avoid losing context. Call this when you complete a step or change goals.',
      parameters: {
        type: 'object',
        properties: {
          current_goal: { type: 'string' },
          done_steps: { type: 'string' },
          open_tasks: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Execute a PowerShell command on the Windows system',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to write' },
          content: { type: 'string', description: 'The content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_file_or_url',
      description: 'Open a file or URL with the default application',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'File path or URL to open' }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'plan_tasks',
      description: 'Create a task plan to decompose a complex request into subtasks. Use this for multi-step goals.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The overall goal' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string', description: 'pending | in_progress | done | failed' }
              }
            },
            description: 'List of subtasks'
          }
        },
        required: ['goal', 'tasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: 'Update the status of a subtask in the current plan.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: { type: 'string', description: 'pending | in_progress | done | failed' },
          result: { type: 'string', description: 'Optional result or note' }
        },
        required: ['task_id', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Open a browser and navigate to a URL. Returns page title and text content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_text',
      description: 'Get the text content of the current browser page.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the page by CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input field by CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input' },
          text: { type: 'string', description: 'Text to type' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_command',
      description: 'Run a git command in a specified directory. Supports: status, diff, log, add, commit, branch, checkout, stash. Use for version control awareness.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The git subcommand and args (e.g. "status", "diff --stat", "log --oneline -10", "add .", "commit -m msg")' },
          cwd: { type: 'string', description: 'Working directory (the repo path)' }
        },
        required: ['command', 'cwd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'undo_last_write',
      description: 'Undo the last file write operation, restoring the file to its previous state. Use when a write produced errors or bad results.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delegate_subtasks',
      description: 'Run multiple subtasks in parallel using collaborative agents. Each subtask gets its own AI instance.',
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string', description: 'The instruction for this agent' }
              }
            },
            description: 'List of subtasks to execute in parallel'
          }
        },
        required: ['subtasks']
      }
    }
  }
]

// No visible step limit — loop ends naturally when the model stops calling tools.
const AGENT_SAFETY_LIMIT = 200
const NORMAL_SAFETY_LIMIT = 50
const IDLE_STEP_THRESHOLD = 5

// ─── Tool Permission System ────────────────────────────────────────
const SAFE_TOOLS = new Set([
  'read_file', 'list_directory', 'web_search', 'browser_get_text',
  'update_working_memory', 'plan_tasks', 'update_task_status', 'undo_last_write'
])
const DANGEROUS_TOOLS = new Set([
  'execute_command', 'write_file', 'open_file_or_url', 'git_command',
  'browser_navigate', 'browser_click', 'browser_type', 'delegate_subtasks'
])

interface PendingApproval {
  toolName: string
  args: Record<string, any>
  resolve: (approved: boolean) => void
}
const AGENT_SYSTEM_PROMPT: Record<string, string> = {
  pt: `VOCÊ ESTÁ NO MODO AGENTE AUTÔNOMO COM FERRAMENTAS ILIMITADAS.
Sua missão é resolver COMPLETAMENTE o pedido do usuário. Não há limite de passos — continue trabalhando até terminar tudo.

REGRAS ABSOLUTAS:
1. PLANEJE primeiro usando plan_tasks para decompor o objetivo em subtarefas.
2. EXECUTE as ferramentas uma a uma, marcando cada subtarefa como concluída.
3. NUNCA pare no meio — se uma etapa falhar, tente uma abordagem diferente.
4. NUNCA responda apenas com texto se ainda houver ações técnicas pendentes.
5. Se o usuário pedir para criar algo, crie TODOS os arquivos, pastas, e teste antes de finalizar.
6. Use update_working_memory a cada 3-5 passos para não perder contexto.
7. Só dê a resposta final em texto quando TODAS as tarefas estiverem concluídas.

VOCÊ TEM TEMPO ILIMITADO. Use quantos passos forem necessários. A qualidade da entrega é mais importante que velocidade.`,
  en: `YOU ARE IN AUTONOMOUS AGENT MODE WITH UNLIMITED TOOLS.
Your mission is to FULLY solve the user's request. There is no step limit — keep working until everything is done.

ABSOLUTE RULES:
1. PLAN first using plan_tasks to decompose the goal into subtasks.
2. EXECUTE tools one by one, marking each subtask as completed.
3. NEVER stop midway — if a step fails, try a different approach.
4. NEVER respond with just text if there are still technical actions pending.
5. If the user asks to create something, create ALL files, folders, and test before finishing.
6. Use update_working_memory every 3-5 steps to preserve context.
7. Only give the final text response when ALL tasks are completed.

YOU HAVE UNLIMITED TIME. Use as many steps as needed. Delivery quality matters more than speed.`
}

const PLANNING_MODE_PROMPT: Record<string, string> = {
  pt: `[MODO PLANEJAMENTO ATIVO]\nVocê DEVE criar ou atualizar o plano de tarefas usando 'plan_tasks' antes de realizar qualquer ação técnica significativa. Explique seu raciocínio de planejamento para o usuário.`,
  en: `[PLANNING MODE ACTIVE]\nYou MUST create or update the task plan using 'plan_tasks' before performing any significant technical action. Explain your planning reasoning to the user.`
}

const LANGUAGE_RULE: Record<string, string> = {
  pt: '\n\nREGRA CRÍTICA DE IDIOMA: Você DEVE responder TODAS as mensagens em português brasileiro. Não importa em que idioma o usuário escreva, sua resposta DEVE ser em português. Isso inclui explicações, comentários em código, nomes de variáveis em exemplos, e qualquer texto. NUNCA responda em inglês ou outro idioma.',
  en: '\n\nCRITICAL LANGUAGE RULE: You MUST respond to ALL messages in English. No matter what language the user writes in, your response MUST be in English. This includes explanations, code comments, variable names in examples, and any text. NEVER respond in Portuguese or any other language.'
}

// Priming: first assistant message sets the tone in the correct language
const LANGUAGE_PRIMING: Record<string, { user: string; assistant: string }> = {
  pt: {
    user: 'Em que idioma você deve responder?',
    assistant: 'Eu devo responder sempre em português brasileiro, sem exceções.'
  },
  en: {
    user: 'What language must you respond in?',
    assistant: 'I must always respond in English, without exceptions.'
  }
}

// Reminder injected right before generation (closest to output = strongest influence)
const LANGUAGE_REMINDER: Record<string, string> = {
  pt: '[LEMBRETE DO SISTEMA: Responda SOMENTE em português brasileiro. Toda sua resposta deve estar em português.]',
  en: '[SYSTEM REMINDER: Respond ONLY in English. Your entire response must be in English.]'
}

// ─── Markdown ────────────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true })
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }: any) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="copy-btn" data-copy>Copiar</button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`
}
marked.use({ renderer })

function formatMarkdown(text: string): string {
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html)
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

function isSmallModel(modelName: string): boolean {
  if (!modelName) return false
  const lower = modelName.toLowerCase()
  // Match models with parameter counts <=14B
  const smallSizes = /\b(7b|8b|9b|14b|3b|1b|0\.5b)\b/i
  if (smallSizes.test(lower)) return true
  // Known small model families (without size suffix)
  if (lower.includes('phi') || lower.includes('mistral') && !lower.includes('large')) return true
  // Default to small if no size indicator found (conservative: enables guardrails)
  if (!/\d+b\b/i.test(lower)) return true
  return false
}

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
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [showPermissionMenu, setShowPermissionMenu] = useState(false)
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

  // ─── Load API keys from safeStorage on startup ─────────────────
  // loadSettings() reads only non-sensitive config from localStorage.
  // loadAllCredentials() fetches the 5 API keys from the OS vault
  // (DPAPI / Keychain / libsecret) and merges them into the settings object.
  useEffect(() => {
    const base = loadSettings()
    loadAllCredentials(base)
      .then((settingsWithCredentials) => {
        setSettings(settingsWithCredentials)
      })
      .catch(() => {
        // Fallback: use settings without credentials (empty API keys)
        setSettings(base)
      })
  }, [])

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
      // Ctrl+K: focus search
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      // Ctrl+,: open settings
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
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
        return `Navigated to: ${nav.title} (${nav.url})\n\nPage co