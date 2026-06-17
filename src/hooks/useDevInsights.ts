import { useCallback, useEffect, useRef } from 'react'
import {
  drainInsights,
  hasBufferedInsights,
  setInsightsEnabled,
  summarizeInsights,
  flushInterruptedTurn,
  type InsightEvent,
} from '../services/devInsights'

const CAP = 5000

/** Owns the Dev Insights flush lifecycle: mirrors the `analyticsEnabled`
 *  setting onto the logger, keeps an in-memory mirror of all events for
 *  accurate digests, and flushes buffered events (+ a fresh digest) on an
 *  interval and on app close (beforeunload — same pattern as useConversations).
 *  Call once in App. */
export function useDevInsights(enabled: boolean): { flush: () => void } {
  const allRef = useRef<InsightEvent[]>([])

  useEffect(() => { setInsightsEnabled(enabled) }, [enabled])

  // Load existing events once so the digest reflects history, not just this session.
  useEffect(() => {
    window.electron.devInsightsLoad()
      .then((events) => { if (Array.isArray(events)) allRef.current = events })
      .catch(() => { /* first run / no file yet */ })
  }, [])

  const persist = useCallback((sync: boolean) => {
    const fresh = drainInsights()
    if (fresh.length === 0) return
    allRef.current = [...allRef.current, ...fresh].slice(-CAP)
    const digest = summarizeInsights(allRef.current)
    // Fire-and-forget; the main handler writes synchronously (atomicWriteJSON),
    // so even the beforeunload path lands before the renderer tears down.
    const p = window.electron.devInsightsFlush({ events: fresh, digest })
    if (!sync) p.catch(() => { /* best effort */ })
    else p.catch(() => {})
  }, [])

  useEffect(() => {
    const id = setInterval(() => { if (hasBufferedInsights()) persist(false) }, 20000)
    // Fecha um turno em voo como 'aborted' (app_closed) ANTES do flush, p/ não
    // virar zumbi no digest (ver flushInterruptedTurn). Crash real não passa aqui.
    const onUnload = () => { flushInterruptedTurn(); persist(true) }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(id)
      window.removeEventListener('beforeunload', onUnload)
      persist(false)
    }
  }, [persist])

  return { flush: () => persist(false) }
}
