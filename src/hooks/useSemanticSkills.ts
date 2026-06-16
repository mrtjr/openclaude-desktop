import { useRef, useCallback } from 'react'
import type { Skill } from '../types/skill'
import { rankBySimilarity } from '../utils/semanticMatch'

interface Options {
  enabled: boolean
  skillsRef: React.MutableRefObject<Skill[]>
  /** Modelo de embedding do Ollama (mesmo padrão do RAG). */
  model?: string
}

const CACHE_CAP = 200

/**
 * Matching semântico de skills (Fase 5, v2.56.0). Opt-in. Embeda a mensagem e as
 * descrições das skills (cache local, via ragEmbed/Ollama) e devolve as mais
 * SIMILARES por significado — para o useChat surgir skills relevantes mesmo sem
 * a palavra-gatilho exata. Best-effort: se o Ollama não responder, devolve []
 * e o app cai no matchSkillsByText (keyword) de sempre.
 */
export function useSemanticSkills({ enabled, skillsRef, model = 'mxbai-embed-large' }: Options) {
  const cacheRef = useRef<Map<string, number[]>>(new Map())

  const embed = async (text: string): Promise<number[] | null> => {
    try {
      const r = await window.electron.ragEmbed?.({ model, text })
      if (!r || r.error || !r.embedding?.length) return null
      return r.embedding
    } catch { return null }
  }

  const matchSemantic = useCallback(async (text: string): Promise<Skill[]> => {
    if (!enabled || !text || !text.trim() || !window.electron?.ragEmbed) return []
    const candidates = (skillsRef.current || []).filter(
      s => s.enabled && !s.pinned && s.status !== 'staging' && s.description,
    )
    if (candidates.length === 0) return []

    const q = await embed(text)
    if (!q) return []  // Ollama indisponível → fallback keyword no chamador

    const items: { item: Skill; vec: number[] }[] = []
    for (const s of candidates) {
      let vec = cacheRef.current.get(s.description)
      if (!vec) {
        const v = await embed(s.description)
        if (!v) continue
        if (cacheRef.current.size >= CACHE_CAP) cacheRef.current.clear()
        cacheRef.current.set(s.description, v)
        vec = v
      }
      items.push({ item: s, vec })
    }
    return rankBySimilarity(q, items, 3, 0.62).map(r => r.item)
  }, [enabled, model, skillsRef])

  return { matchSemantic }
}
