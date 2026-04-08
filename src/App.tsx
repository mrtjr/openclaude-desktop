import { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/github-dark.css'
import { Send, Plus, Trash2, Minus, Square, X, Bot, User, Loader2, ChevronDown, Wrench, Terminal, Search, Settings as SettingsIcon, Download, FileText, XCircle, MessageSquare, Play, Code, Globe, FileCode, Info, ArrowUpCircle, Zap, BotOff, Copy, RefreshCw, Pin, PanelLeftClose, PanelLeft, Sun, Moon, Image, Trash, Mic, MicOff, Volume2, ListChecks, CheckCircle2, Circle, AlertCircle, Clock, BarChart3 } from 'lucide-react'
import SettingsModal, { loadSettings, type AppSettings } from './Settings'
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
// Safety valve prevents truly infinite loops (unreachable in normal use).
const AGENT_SAFETY_LIMIT = 200
const NORMAL_SAFETY_LIMIT = 50
// If the model produces N consecutive steps with zero real tool progress, force stop
const IDLE_STEP_THRESHOLD = 5
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

  const executeTool = async (name: string, args: Record<string, any>): Promise<string> => {
    const out = await executeToolRaw(name, args)
    
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

        // Sliding window: limit context to avoid token overflow
        const MAX_CONTEXT_MESSAGES = settings.contextLimit || 50
        const trimmedHistory = history.length > MAX_CONTEXT_MESSAGES
          ? history.slice(-MAX_CONTEXT_MESSAGES)
          : history

        // Language priming: inject a fake Q&A exchange that locks the language
        const priming = LANGUAGE_PRIMING[lang]
        const primingMessages = [
          { role: 'user', content: priming.user },
          { role: 'assistant', content: priming.assistant }
        ]

        let continueLoop = true
        let allMessages: any[] = [...systemMessages, ...primingMessages, ...trimmedHistory]
        const useStreaming = settings.streamingEnabled
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

          if (isAgentMode && isSmallModel(selectedModel)) {
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

            window.electron.ollamaChatStream({
              model: selectedModel,
              messages: requestMessages,
              tools: TOOLS,
              temperature: settings.temperature,
              max_tokens: settings.maxTokens
            }).catch((err: any) => {
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
          const response = await window.electron.ollamaChat({
            model: selectedModel,
            messages: requestMessages,
            tools: TOOLS,
            temperature: settings.temperature,
            max_tokens: settings.maxTokens
          })

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
    <div className="app-container">
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

      {/* Analytics Dashboard (MAGI) */}
      <AnalyticsDashboard
        isOpen={showAnalytics}
        onClose={() => setShowAnalytics(false)}
        language={settings.language}
      />

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
            </div>
          </div>
        </div>

        {/* Chat area */}
        <div className="chat-area">
          <div className="messages-container" ref={messagesContainerRef}>
            {!activeConv || activeConv.messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-logo-large">OC</div>
                <h2>Como posso ajudar?</h2>
                <p>Modelo atual: <strong>{selectedModel}</strong> via Ollama</p>
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

          {/* Input area */}
          <div className="input-area">
            <div className="input-container">
              <input type="file" id="image-upload" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const base64 = reader.result as string
                  setInput(prev => prev + `\n[Imagem anexada: ${file.name}]\n`)
                  showToast(`Imagem ${file.name} anexada`)
                }
                reader.readAsDataURL(file)
                e.target.value = ''
              }} />
              <button className="attach-btn" onClick={() => document.getElementById('image-upload')?.click()} title="Anexar imagem">
                <Image size={16} />
              </button>
              <button className={`attach-btn ${isListening ? 'active-voice' : ''}`} onClick={toggleListening} title={isListening ? 'Parar gravação' : 'Falar'}>
                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <button className={`attach-btn ${ttsEnabled ? 'active-voice' : ''}`} onClick={() => { setTtsEnabled(p => !p); if (ttsEnabled) speechSynthesis.cancel() }} title={ttsEnabled ? 'Desativar voz' : 'Ativar leitura em voz'}>
                <Volume2 size={16} />
              </button>
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
              {input.length > 0 && (
                <button className="clear-input-btn" onClick={() => { setInput(''); textareaRef.current?.focus() }} title="Limpar input">
                  <XCircle size={16} />
                </button>
              )}
              <button
                className={`send-btn ${(!input.trim() || isLoading) ? 'disabled' : ''}`}
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
              >
                {isLoading ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
              </button>
              <div className="input-actions-divider" />
              <button 
                className={`agent-toggle-btn ${isAgentMode ? 'active' : ''}`}
                onClick={() => setIsAgentMode(!isAgentMode)}
                title={isAgentMode ? "Desativar Modo Agente" : "Ativar Modo Agente"}
              >
                <Zap size={18} />
                <span>Agente</span>
              </button>
            </div>
            <div className="input-footer">
              <p className="input-hint">OpenClaude pode cometer erros. Verifique informacoes importantes. | Ctrl+N nova conversa | Ctrl+, config</p>
              {input.length > 0 && (
                <span className="token-counter">{Math.ceil(input.length / 4)} / 4096 tokens</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
