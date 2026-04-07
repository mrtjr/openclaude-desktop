import { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { Send, Plus, Trash2, Minus, Square, X, Bot, User, Loader2, ChevronDown, Wrench, Terminal, Search, Settings as SettingsIcon, Download, FileText, XCircle, MessageSquare, Play, Code, Globe, FileCode, Info, ArrowUpCircle, Zap, BotOff } from 'lucide-react'
import SettingsModal, { loadSettings, type AppSettings } from './Settings'

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

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
}

// ─── Tools ───────────────────────────────────────────────────────────
const TOOLS = [
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
  }
]

const MAX_AGENT_STEPS = 10
const AGENT_SYSTEM_PROMPT = `VOCÊ ESTÁ NO MODO AGENTE AUTÔNOMO.
Sua missão é resolver o pedido do usuário usando suas ferramentas de forma proativa.
1. Planeje os passos necessários.
2. Execute as ferramentas uma a uma.
3. Analise os resultados e ajuste seu plano se necessário.
4. Continue até que o objetivo seja totalmente alcançado.
NÃO pare apenas para relatar o progresso se ainda houver passos técnicos a serem executados. Se o usuário pedir para criar um projeto, crie as pastas, arquivos e teste-os antes de finalizar.`

// ─── Markdown ────────────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true })
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }: any) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText)">Copiar</button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`
}
marked.use({ renderer })

function formatMarkdown(text: string): string {
  return marked.parse(text) as string
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

// ─── App ─────────────────────────────────────────────────────────────
export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('qwen35-uncensored')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen] = useState(true)
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
  const [isAgentMode, setIsAgentMode] = useState(false)
  const [agentSteps, setAgentSteps] = useState(0)
  const [stopRequested, setStopRequested] = useState(false)
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
        setConversations(data)
        setActiveConvId(data[0].id)
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
        if (names.includes('qwen35-uncensored')) setSelectedModel('qwen35-uncensored')
        else if (names.length > 0) setSelectedModel(names[0])
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
  const executeTool = async (name: string, args: Record<string, any>): Promise<string> => {
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
      return 'Ferramenta nao reconhecida'
    } catch (e: any) {
      return `Erro: ${e.message}`
    }
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

  const stopAgent = () => {
    setStopRequested(true)
    setIsLoading(false)
    setIsStreaming(false)
    if (streamCleanupRef.current) {
      streamCleanupRef.current()
      streamCleanupRef.current = null
    }
    showToast('Agente interrompido pelo usuário.')
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
      setStopRequested(false)

      try {
        const conv = conversationsRef.current.find(c => c.id === activeConvId)
        let systemPrompt = settings.systemPrompt || ''
        if (isAgentMode) {
          systemPrompt = AGENT_SYSTEM_PROMPT + (systemPrompt ? "\n\nInstruções Adicionais:\n" + systemPrompt : "")
        }
        
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

        let continueLoop = true
        let allMessages: any[] = [...systemMessages, ...history]
        const useStreaming = settings.streamingEnabled
        let steps = 0

        while (continueLoop && steps < (isAgentMode ? MAX_AGENT_STEPS : 5)) {
          if (stopRequested) break;
          steps++
          setAgentSteps(steps)
          
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
              messages: allMessages,
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
                arguments: (() => { try { return JSON.parse(tc.function.arguments) } catch { return {} } })()
              })),
              timestamp: new Date()
            }

            const toolResults: ToolResult[] = []
            for (const tc of toolCallsData) {
              let args: Record<string, any> = {}
              try { args = JSON.parse(tc.function.arguments) } catch {}
              const result = await executeTool(tc.function.name, args)
              toolResults.push({ toolCallId: tc.id, name: tc.function.name, result })
            }
            thinkingMsg.toolResults = toolResults

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
            
            // Se NÃO estiver em modo agente, paramos após a primeira execução de ferramenta para o usuário ver o resultado
            if (!isAgentMode) {
              continueLoop = false
            }
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
            continueLoop = false
          }

          if (finishReason === 'stop') continueLoop = false

        } else {
          // ─── Non-streaming path ────────────────────────────
          const response = await window.electron.ollamaChat({
            model: selectedModel,
            messages: allMessages,
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
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments
              })),
              timestamp: new Date()
            }

            const toolResults: ToolResult[] = []
            for (const tc of toolCalls) {
              const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments
              const result = await executeTool(tc.function.name, args)
              toolResults.push({ toolCallId: tc.id, name: tc.function.name, result })
            }

            thinkingMsg.toolResults = toolResults
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

            // Se NÃO estiver em modo agente, paramos após a primeira execução de ferramenta
            if (!isAgentMode) {
              continueLoop = false
            }
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
            continueLoop = false
          }

          if (choice.finish_reason === 'stop') continueLoop = false
        }
      }
    } catch (e: any) {
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
    }
  }, [input, isLoading, activeConvId, selectedModel, settings])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ─── Filtered conversations ────────────────────────────────────
  const filteredConversations = searchQuery.trim()
    ? conversations.filter(c => {
        const q = searchQuery.toLowerCase()
        if (c.title.toLowerCase().includes(q)) return true
        return c.messages.some(m => m.content.toLowerCase().includes(q))
      })
    : conversations

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
          {activeConv && activeConv.messages.length > 0 && (
            <button className="titlebar-action-btn export-btn" onClick={exportConversation} title="Exportar conversa">
              <Download size={14} />
              <span>Exportar</span>
            </button>
          )}
          <button className="titlebar-action-btn" onClick={() => setShowSettings(true)} title="Configuracoes (Ctrl+,)">
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
                  className={`conv-item ${conv.id === activeConvId ? 'active' : ''}`}
                  onClick={() => setActiveConvId(conv.id)}
                >
                  <MessageSquare size={14} className="conv-icon" />
                  <div className="conv-info">
                    <span className="conv-title">{conv.title}</span>
                    <span className="conv-date">{getRelativeTime(conv.createdAt)}</span>
                  </div>
                  <button className="conv-delete" onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}>
                    <Trash2 size={12} />
                  </button>
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
                      onClick={() => { setSelectedModel(m); setShowModelDropdown(false) }}>
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
                    <div className="message-timestamp">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                        <span>Agente: Passo {agentSteps}/{MAX_AGENT_STEPS}</span>
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

          {/* Input area */}
          <div className="input-area">
            <div className="input-container">
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
