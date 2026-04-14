import { useEffect, useRef, useCallback } from 'react'
import {
  lightDream,
  deepDream,
  shouldDream,
  updateHealthScores,
  type AgentMemory,
} from '../services/memoryDreaming'

interface UseMemoryDreamingOptions {
  enabled: boolean  // settings.memoryEnabled
  onToast?: (message: string) => void
}

/**
 * Background memory dreaming hook.
 * - Runs light dreaming every 2 hours of active use
 * - Runs deep dreaming every 24 hours
 * - Triggers deep dream on app close (via beforeunload)
 */
export function useMemoryDreaming({ enabled, onToast }: UseMemoryDreamingOptions) {
  const dreamingRef = useRef(false)

  const runDream = useCallback(async (type: 'light' | 'deep') => {
    if (dreamingRef.current || !enabled) return
    dreamingRef.current = true

    try {
      const raw = await window.electron.loadAgentMemory()
      const memory: AgentMemory = raw

      if (!shouldDream(memory, type)) {
        dreamingRef.current = false
        return
      }

      const dreamed = type === 'deep' ? deepDream(memory) : lightDream(memory)

      await window.electron.saveAgentMemory(dreamed)

      if (type === 'deep') {
        const pruned = memory.workingMemory.length - dreamed.workingMemory.length
        if (pruned > 0 && onToast) {
          onToast(`Memory consolidation: ${pruned} stale memories removed`)
        }
      }
    } catch (e) {
      console.warn('[memoryDreaming] dream error:', e)
    } finally {
      dreamingRef.current = false
    }
  }, [enabled, onToast])

  // Light dreaming check every 30 minutes
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => runDream('light'), 30 * 60 * 1000)
    // Run initial light dream after 2 minutes
    const timeout = setTimeout(() => runDream('light'), 2 * 60 * 1000)
    return () => { clearInterval(interval); clearTimeout(timeout) }
  }, [enabled, runDream])

  // Deep dreaming check every 6 hours
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => runDream('deep'), 6 * 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [enabled, runDream])

  // Trigger deep dream on page unload (app closing)
  useEffect(() => {
    if (!enabled) return
    const handleBeforeUnload = () => {
      // Fire and forget — can't await in beforeunload
      runDream('deep')
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [enabled, runDream])

  return {
    triggerLightDream: () => runDream('light'),
    triggerDeepDream: () => runDream('deep'),
  }
}
