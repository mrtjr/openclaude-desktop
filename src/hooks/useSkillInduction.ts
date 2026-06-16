import { useEffect, useRef, useCallback } from 'react'
import type { Skill } from '../types/skill'
import { induceAndReconcile } from '../utils/memoryInduction'

interface Options {
  enabled: boolean
  /** Ref com as skills atuais (evita closure obsoleta no intervalo). */
  skillsRef: React.MutableRefObject<Skill[]>
  persistSkills: (next: Skill[]) => void
  onToast?: (message: string) => void
  language?: string
}

/**
 * Indução de skills de domínio em background (Fase 3, v2.54.0). Periodicamente
 * lê os fatos persistidos (bucket `facts`, alimentado pelo remember_fact),
 * clusteriza por domínio recorrente e adiciona RASCUNHOS de skill em staging
 * (enabled:false) — que NÃO entram no manifesto até aprovação (Fase 4). Roda
 * fora do caminho quente; idempotente (não recria skills já existentes).
 */
export function useSkillInduction({ enabled, skillsRef, persistSkills, onToast, language }: Options) {
  const runningRef = useRef(false)

  const run = useCallback(async () => {
    if (runningRef.current || !enabled) return
    if (!window.electron?.loadMemory) return
    runningRef.current = true
    try {
      const mem = await window.electron.loadMemory()
      const facts: string[] = Array.isArray((mem as any)?.facts) ? (mem as any).facts : []
      const current = skillsRef.current || []
      const { drafts, updates } = induceAndReconcile(facts, current, { now: Date.now() })
      if (drafts.length > 0 || updates.length > 0) {
        let next = [...current, ...drafts]
        if (updates.length > 0) {
          const byId = new Map(updates.map(u => [u.id, u]))
          next = next.map(s => byId.get(s.id) || s)
        }
        persistSkills(next)
        if (drafts.length > 0) {
          onToast?.(language === 'en'
            ? `${drafts.length} learned skill draft(s) — review in Skills`
            : `${drafts.length} skill(s) de domínio em rascunho — revise em Skills`)
        } else if (updates.length > 0) {
          onToast?.(language === 'en'
            ? `${updates.length} learned skill(s) updated with new facts`
            : `${updates.length} skill(s) aprendida(s) atualizada(s) com novos fatos`)
        }
      }
    } catch (e) {
      console.warn('[skillInduction] error:', e)
    } finally {
      runningRef.current = false
    }
  }, [enabled, persistSkills, onToast, language, skillsRef])

  useEffect(() => {
    if (!enabled) return
    const timeout = setTimeout(run, 3 * 60 * 1000)      // 3 min após abrir
    const interval = setInterval(run, 30 * 60 * 1000)   // a cada 30 min
    return () => { clearTimeout(timeout); clearInterval(interval) }
  }, [enabled, run])

  return { triggerInduction: run }
}
