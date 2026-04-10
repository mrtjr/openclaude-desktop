/**
 * useAgentMemory.ts — v1.9.0
 * Hook para carregar/salvar a memória persistente do agente.
 *
 * Uso em App.tsx (no agentLoop):
 *   const { agentMemory, saveMemoryEntry, appendEpisode, buildMemoryContext } = useAgentMemory()
 *
 *   // Injetar como contexto no system prompt:
 *   const memCtx = buildMemoryContext()
 *   // → "Working Memory:\n- projeto_atual: openclaude-desktop\n..."
 */
import { useState, useEffect, useCallback } from 'react'

interface MemoryEntry {
  key:       string
  value:     string
  updatedAt: number
}

interface EpisodicEntry {
  summary:        string
  conversationId: string
  timestamp:      number
}

interface AgentMemory {
  workingMemory: MemoryEntry[]
  episodic:      EpisodicEntry[]
  pinned:        { content: string; pinnedAt: number }[]
  version:       number
}

const el = (window as any).electron

export function useAgentMemory() {
  const [agentMemory, setAgentMemory] = useState<AgentMemory>({
    workingMemory: [],
    episodic:      [],
    pinned:        [],
    version:       1,
  })
  const [loaded, setLoaded] = useState(false)

  // Load on mount
  useEffect(() => {
    if (!el?.loadAgentMemory) return
    el.loadAgentMemory().then((data: AgentMemory) => {
      if (data) setAgentMemory(data)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const persistMemory = useCallback(async (updated: AgentMemory) => {
    setAgentMemory(updated)
    if (el?.saveAgentMemory) await el.saveAgentMemory(updated)
  }, [])

  /** Upsert a working memory key */
  const saveMemoryEntry = useCallback(async (key: string, value: string) => {
    setAgentMemory(prev => {
      const idx = prev.workingMemory.findIndex(m => m.key === key)
      const entry: MemoryEntry = { key, value, updatedAt: Date.now() }
      const wm = [...prev.workingMemory]
      if (idx >= 0) wm[idx] = entry; else wm.push(entry)
      const updated = { ...prev, workingMemory: wm }
      if (el?.saveAgentMemory) el.saveAgentMemory(updated).catch(() => {})
      return updated
    })
  }, [])

  /** Append an episodic memory after an agent session ends */
  const appendEpisode = useCallback(async (summary: string, conversationId: string) => {
    setAgentMemory(prev => {
      const episodes = [...prev.episodic, { summary, conversationId, timestamp: Date.now() }].slice(-200)
      const updated = { ...prev, episodic: episodes }
      if (el?.saveAgentMemory) el.saveAgentMemory(updated).catch(() => {})
      return updated
    })
  }, [])

  /**
   * Build a string context block to inject into the system prompt.
   * Only includes workingMemory + last 3 episodic summaries to stay token-efficient.
   */
  const buildMemoryContext = useCallback((): string => {
    const parts: string[] = []

    if (agentMemory.workingMemory.length > 0) {
      parts.push('## Working Memory')
      for (const m of agentMemory.workingMemory) {
        parts.push(`- ${m.key}: ${m.value}`)
      }
    }

    const recentEpisodes = agentMemory.episodic.slice(-3)
    if (recentEpisodes.length > 0) {
      parts.push('')
      parts.push('## Recent Sessions')
      for (const ep of recentEpisodes) {
        const date = new Date(ep.timestamp).toLocaleString()
        parts.push(`[${date}] ${ep.summary}`)
      }
    }

    return parts.length > 0 ? parts.join('\n') : ''
  }, [agentMemory])

  return { agentMemory, loaded, saveMemoryEntry, appendEpisode, buildMemoryContext, persistMemory }
}
