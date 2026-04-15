import { useRef, useCallback, useMemo } from 'react'
import type { AppSettings, ModalKey } from '../Settings'
import { POOL_CONFIG } from '../constants/pool'

interface KeySlot {
  key: string
  label?: string
  busy: boolean
  cooldownUntil?: number
  lastError?: string
}

export interface ModalKeyPool {
  acquire: () => KeySlot | null
  acquireOrWait: (timeoutMs?: number) => Promise<KeySlot | null>
  release: (key: string) => void
  markError: (key: string, err: string) => void
  availableCount: number
  totalCount: number
  snapshot: () => KeySlot[]
}

export function useModalKeyPool(settings: AppSettings): ModalKeyPool {
  const slotsRef = useRef<Map<string, KeySlot>>(new Map())
  const rrIndexRef = useRef(0)
  // Event-driven waiters: resolvers waiting for the next free key
  const waitersRef = useRef<Array<(slot: KeySlot | null) => void>>([])

  const enabledKeys: ModalKey[] = useMemo(
    () =>
      (settings.modalApiKeys || []).filter(
        (k) => k.enabled && k.key.trim().length >= POOL_CONFIG.MIN_KEY_LENGTH
      ),
    [settings.modalApiKeys]
  )

  // Sync slots with current enabled keys, preserving runtime state (busy/cooldown)
  const currentSlots = useMemo(() => {
    const next = new Map<string, KeySlot>()
    enabledKeys.forEach((mk, index) => {
      const existing = slotsRef.current.get(mk.key)
      next.set(mk.key, existing || {
        key: mk.key,
        label: mk.label || `Key ${index + 1}`,
        busy: false,
      })
    })
    slotsRef.current = next
    return Array.from(next.values())
  }, [enabledKeys])

  const isAvailable = (slot: KeySlot): boolean => {
    if (slot.busy) return false
    if (slot.cooldownUntil && slot.cooldownUntil > Date.now()) return false
    return true
  }

  const acquire = useCallback((): KeySlot | null => {
    const slots = Array.from(slotsRef.current.values())
    const n = slots.length
    if (n === 0) return null
    for (let i = 0; i < n; i++) {
      const idx = (rrIndexRef.current + i) % n
      const slot = slots[idx]
      if (isAvailable(slot)) {
        slot.busy = true
        rrIndexRef.current = (idx + 1) % n
        return slot
      }
    }
    return null
  }, [])

  /** Notify the oldest waiter that a key may be free. */
  const drainWaiter = useCallback(() => {
    while (waitersRef.current.length > 0) {
      const slot = acquire()
      if (!slot) return
      const resolve = waitersRef.current.shift()
      if (resolve) resolve(slot)
      else {
        // No one wanted it — release back
        slot.busy = false
        return
      }
    }
  }, [acquire])

  const release = useCallback((key: string) => {
    const slot = slotsRef.current.get(key)
    if (slot) slot.busy = false
    drainWaiter()
  }, [drainWaiter])

  const markError = useCallback((key: string, err: string) => {
    const slot = slotsRef.current.get(key)
    if (slot) {
      slot.lastError = err
      const isRateLimit = /429|rate.?limit|too.?many/i.test(err)
      if (isRateLimit) {
        slot.cooldownUntil = Date.now() + POOL_CONFIG.COOLDOWN_429_MS
      }
      slot.busy = false
    }
    drainWaiter()
  }, [drainWaiter])

  const acquireOrWait = useCallback(
    async (timeoutMs: number = POOL_CONFIG.ACQUIRE_TIMEOUT_MS): Promise<KeySlot | null> => {
      if (slotsRef.current.size === 0) return null
      const immediate = acquire()
      if (immediate) return immediate

      return new Promise<KeySlot | null>((resolve) => {
        let done = false
        const finish = (slot: KeySlot | null) => {
          if (done) return
          done = true
          resolve(slot)
        }
        waitersRef.current.push(finish)
        setTimeout(() => {
          if (done) return
          // Remove self from queue on timeout
          const idx = waitersRef.current.indexOf(finish)
          if (idx >= 0) waitersRef.current.splice(idx, 1)
          finish(null)
        }, timeoutMs)
      })
    },
    [acquire]
  )

  const availableCount = currentSlots.filter(isAvailable).length
  const totalCount = currentSlots.length

  const snapshot = useCallback(
    () => Array.from(slotsRef.current.values()).map((s) => ({ ...s })),
    []
  )

  return {
    acquire,
    acquireOrWait,
    release,
    markError,
    availableCount,
    totalCount,
    snapshot,
  }
}
