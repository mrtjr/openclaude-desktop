import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Conversation } from '../types'
import { generateId } from '../utils/formatting'
import { sanitizeTitle } from '../utils/conversationTitle'

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [pinnedConvs, setPinnedConvs] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('openclaude-pinned') || '[]')) } catch { return new Set() }
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  // True após o carregamento inicial do disco. Antes disso NÃO salvamos (o
  // estado [] inicial sobrescreveria os dados reais). Depois, salvamos MESMO
  // vazio — senão excluir a última conversa não persistia (ela reaparecia no
  // reload). v2.85.1.
  const hasLoadedRef = useRef(false)

  const activeConv = conversations.find(c => c.id === activeConvId)

  // ─── Load conversations from disk ──────────────────────────────
  const newConversation = useCallback((): string => {
    const conv: Conversation = {
      id: generateId(),
      title: 'Nova conversa',
      messages: [],
      createdAt: new Date()
    }
    setConversations(prev => [conv, ...prev])
    setActiveConvId(conv.id)
    return conv.id
  }, [])

  useEffect(() => {
    setLoadingConversations(true)
    window.electron.loadConversations().then((data: any) => {
      if (Array.isArray(data) && data.length > 0) {
        const parsed = data.map((c: any) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          // Defensivo: se UMA conversa salva tiver messages ausente/não-array,
          // o .map lançava, o .catch chamava newConversation() e o usuário
          // perdia TODO o histórico. Degrada para [] em vez de apagar tudo.
          messages: Array.isArray(c.messages)
            ? c.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
            : []
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
      hasLoadedRef.current = true // a partir daqui, salvar mesmo vazio
    })
  }, [])

  // ─── Save conversations with debounce (1s) ─────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // Salva quando já carregou (inclusive a lista VAZIA, p/ persistir a exclusão
    // da última conversa). Antes do load, não salva (não sobrescreve o disco).
    if (hasLoadedRef.current) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        window.electron.saveConversations(conversations).catch(e => console.warn('[conversations] save error:', e))
      }, 1000)
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [conversations])

  // ─── Flush pending save on app close ───────────────────────────
  // The 1s debounce above drops the last change if the app closes inside
  // its window — send a message and quit, and it's gone. Flush on
  // beforeunload using the ref (always current, no stale closure): clear
  // the pending timer and write immediately. The main handler is a
  // synchronous atomicWriteJSON (v2.12.15), so even fire-and-forget here
  // lands the save before the renderer tears down.
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const convs = conversationsRef.current
      if (hasLoadedRef.current) {
        window.electron.saveConversations(convs).catch(() => { /* unloading */ })
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // ─── Immediate save (bypass debounce for critical updates) ─────
  const saveNow = useCallback(() => {
    if (conversations.length > 0) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      window.electron.saveConversations(conversations).catch(e => console.warn('[conversations] saveNow error:', e))
    }
  }, [conversations])

  // ─── Debounced search ──────────────────────────────────────────
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 200)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery])

  // ─── Filtered & sorted conversations ───────────────────────────
  const filteredConversations = useMemo(() => {
    let list = conversations
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      // (c.title/m.content podem ser undefined em dados legados — guarda p/ a
      // busca não derrubar o render ao digitar.)
      list = list.filter(c => (c.title || '').toLowerCase().includes(q) || (c.messages || []).some(m => (m.content || '').toLowerCase().includes(q)))
    }
    return [...list].sort((a, b) => {
      const ap = pinnedConvs.has(a.id) ? 1 : 0
      const bp = pinnedConvs.has(b.id) ? 1 : 0
      return bp - ap
    })
  }, [conversations, debouncedSearch, pinnedConvs])

  const deleteConversation = useCallback((id: string) => {
    // Apaga o relatório .md vinculado a esta conversa (v2.85.0) — o registro
    // não sobrevive à conversa nem vaza para outra.
    window.electron.reportDelete?.({ id }).catch(() => { /* best-effort */ })
    setConversations(prev => {
      const remaining = prev.filter(c => c.id !== id)
      if (id === activeConvId) {
        // Excluir a ÚLTIMA conversa NÃO abre uma nova (comportamento pedido):
        // fica em estado vazio (tela "Como posso ajudar?"); uma conversa só é
        // criada quando o usuário começa a digitar/enviar ou clica em + Nova.
        setActiveConvId(remaining.length > 0 ? remaining[0].id : null)
      }
      return remaining
    })
  }, [activeConvId])

  // Renomear (estilo ChatGPT/Claude, v2.137.0): marca titleManual p/ a
  // auto-titulação da 1ª mensagem não sobrescrever. Título vazio é ignorado.
  const renameConversation = useCallback((id: string, rawTitle: string) => {
    const title = sanitizeTitle(rawTitle)
    if (!title) return
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title, titleManual: true } : c))
  }, [])

  const togglePin = useCallback((convId: string) => {
    setPinnedConvs(prev => {
      const next = new Set(prev)
      if (next.has(convId)) next.delete(convId)
      else next.add(convId)
      localStorage.setItem('openclaude-pinned', JSON.stringify([...next]))
      return next
    })
  }, [])

  const exportConversation = useCallback(async (showToast: (msg: string) => void) => {
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

    // Include working memory if present
    if (activeConv.workingMemory && Object.keys(activeConv.workingMemory).length > 0) {
      md += `\n---\n\n## Working Memory\n\n\`\`\`json\n${JSON.stringify(activeConv.workingMemory, null, 2)}\n\`\`\`\n\n`
    }

    // Include task plan if present
    if (activeConv.taskPlan) {
      md += `## Plano de Tarefas\n\n**Objetivo:** ${activeConv.taskPlan.goal}\n\n`
      for (const task of activeConv.taskPlan.tasks) {
        const icon = task.status === 'done' ? '[x]' : task.status === 'running' ? '[~]' : '[ ]'
        md += `- ${icon} ${task.title}${task.result ? ` - ${task.result}` : ''}\n`
      }
      md += '\n'
    }

    await window.electron.writeFile({ filePath: result.filePath, content: md })
    showToast('Conversa exportada com sucesso!')
  }, [activeConv])

  return {
    conversations,
    setConversations,
    conversationsRef,
    activeConvId,
    setActiveConvId,
    activeConv,
    loadingConversations,
    pinnedConvs,
    searchQuery,
    setSearchQuery,
    filteredConversations,
    saveNow,
    newConversation,
    deleteConversation,
    renameConversation,
    togglePin,
    exportConversation,
  }
}
