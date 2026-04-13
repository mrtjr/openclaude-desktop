import { useState, useEffect, useRef, useCallback } from 'react'
import type { Conversation } from '../types'
import { generateId } from '../utils/formatting'

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

  const activeConv = conversations.find(c => c.id === activeConvId)

  // ─── Load conversations from disk ──────────────────────────────
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

  // ─── Debounced search ──────────────────────────────────────────
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 200)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery])

  // ─── Filtered & sorted conversations ───────────────────────────
  const filteredConversations = (() => {
    let list = conversations
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      list = list.filter(c => c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q)))
    }
    return [...list].sort((a, b) => {
      const ap = pinnedConvs.has(a.id) ? 1 : 0
      const bp = pinnedConvs.has(b.id) ? 1 : 0
      return bp - ap
    })
  })()

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const remaining = prev.filter(c => c.id !== id)
      if (id === activeConvId) {
        if (remaining.length > 0) {
          setActiveConvId(remaining[0].id)
        } else {
          // Will trigger newConversation via effect or caller
          const conv: Conversation = {
            id: generateId(),
            title: 'Nova conversa',
            messages: [],
            createdAt: new Date()
          }
          setActiveConvId(conv.id)
          return [conv]
        }
      }
      return remaining
    })
  }, [activeConvId])

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
    newConversation,
    deleteConversation,
    togglePin,
    exportConversation,
  }
}
