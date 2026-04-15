import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useModalKeyPool } from '../src/hooks/useModalKeyPool'
import { DEFAULT_SETTINGS } from '../src/Settings'
import type { AppSettings } from '../src/Settings'

function makeSettings(keys: Array<{ key: string; enabled: boolean; label?: string }>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    provider: 'modal',
    modalApiKeys: keys.map((k, i) => ({
      id: `id-${i}`,
      key: k.key,
      enabled: k.enabled,
      label: k.label,
    })),
  }
}

// Valid keys need ≥20 chars (see POOL_CONFIG.MIN_KEY_LENGTH)
const K1 = 'modal-test-key-0000001'
const K2 = 'modal-test-key-0000002'
const K3 = 'modal-test-key-0000003'

describe('useModalKeyPool', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('reports totalCount based on enabled + valid keys only', () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([
        { key: K1, enabled: true },
        { key: K2, enabled: false }, // disabled
        { key: 'too-short', enabled: true }, // too short
      ]))
    )
    expect(result.current.totalCount).toBe(1)
    expect(result.current.availableCount).toBe(1)
  })

  it('acquire returns a slot and marks it busy', () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([{ key: K1, enabled: true }]))
    )

    let slot: ReturnType<typeof result.current.acquire> = null
    act(() => { slot = result.current.acquire() })
    expect(slot).not.toBeNull()
    expect(slot!.key).toBe(K1)

    // Second acquire returns null — key is busy
    let slot2: ReturnType<typeof result.current.acquire> = null
    act(() => { slot2 = result.current.acquire() })
    expect(slot2).toBeNull()
  })

  it('release makes the key acquirable again', () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([{ key: K1, enabled: true }]))
    )

    act(() => { result.current.acquire() })
    act(() => { result.current.release(K1) })

    let slot: ReturnType<typeof result.current.acquire> = null
    act(() => { slot = result.current.acquire() })
    expect(slot).not.toBeNull()
    expect(slot!.key).toBe(K1)
  })

  it('round-robin distributes across multiple keys', () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([
        { key: K1, enabled: true },
        { key: K2, enabled: true },
        { key: K3, enabled: true },
      ]))
    )

    const acquired: string[] = []
    act(() => {
      const a = result.current.acquire()
      const b = result.current.acquire()
      const c = result.current.acquire()
      if (a) acquired.push(a.key)
      if (b) acquired.push(b.key)
      if (c) acquired.push(c.key)
    })
    // All three distinct keys used
    expect(new Set(acquired).size).toBe(3)
  })

  it('markError with 429 applies cooldown and skips the key', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([
        { key: K1, enabled: true },
        { key: K2, enabled: true },
      ]))
    )

    // Acquire both, mark K1 with 429
    let s1: ReturnType<typeof result.current.acquire> = null
    act(() => { s1 = result.current.acquire() })
    act(() => { result.current.markError(s1!.key, 'HTTP 429: Too Many Requests') })
    // K1 is now in cooldown
    act(() => { result.current.release(K2) /* noop - K2 wasn't acquired */ })

    // Acquire should return K2 only (K1 in cooldown)
    let s2: ReturnType<typeof result.current.acquire> = null
    act(() => { s2 = result.current.acquire() })
    expect(s2).not.toBeNull()
    expect(s2!.key).toBe(K2)

    // Can't acquire another — K1 in cooldown, K2 busy
    let s3: ReturnType<typeof result.current.acquire> = null
    act(() => { s3 = result.current.acquire() })
    expect(s3).toBeNull()

    vi.useRealTimers()
  })

  it('markError without 429 does NOT apply cooldown', () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([{ key: K1, enabled: true }]))
    )

    let s: ReturnType<typeof result.current.acquire> = null
    act(() => { s = result.current.acquire() })
    act(() => { result.current.markError(s!.key, 'Generic network error') })

    // Should be available immediately (no cooldown)
    let s2: ReturnType<typeof result.current.acquire> = null
    act(() => { s2 = result.current.acquire() })
    expect(s2).not.toBeNull()
  })

  it('acquireOrWait resolves immediately if slot is free', async () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([{ key: K1, enabled: true }]))
    )

    const slot = await result.current.acquireOrWait(1000)
    expect(slot).not.toBeNull()
    expect(slot!.key).toBe(K1)
  })

  it('acquireOrWait queues waiters and resolves on release (event-driven)', async () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([{ key: K1, enabled: true }]))
    )

    // Take the only key
    let firstSlot: ReturnType<typeof result.current.acquire> = null
    act(() => { firstSlot = result.current.acquire() })
    expect(firstSlot).not.toBeNull()

    // Start a waiter (shouldn't resolve yet)
    const waiterPromise = result.current.acquireOrWait(5000)

    // Release after a tick
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
      result.current.release(firstSlot!.key)
    })

    const slot = await waiterPromise
    expect(slot).not.toBeNull()
    expect(slot!.key).toBe(K1)
  })

  it('acquireOrWait returns null when no keys configured', async () => {
    const { result } = renderHook(() => useModalKeyPool(makeSettings([])))
    const slot = await result.current.acquireOrWait(100)
    expect(slot).toBeNull()
  })

  it('acquireOrWait times out when all keys stay busy', async () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([{ key: K1, enabled: true }]))
    )

    act(() => { result.current.acquire() })
    const slot = await result.current.acquireOrWait(50) // short timeout
    expect(slot).toBeNull()
  })

  // Regression guard (v2.2.1): the "pool exhausted" deadlock scenario.
  // With 2 keys and 3 tasks, the worker-pool dispatcher should handle the
  // third task by recycling a released key — no deadlock, no null.
  it('regression: worker-pool pattern recycles key for 3 tasks on 2 keys', async () => {
    const { result } = renderHook(() =>
      useModalKeyPool(makeSettings([
        { key: K1, enabled: true },
        { key: K2, enabled: true },
      ]))
    )

    // Simulate 2 workers acquiring keys (both tasks in flight)
    let w1: ReturnType<typeof result.current.acquire> = null
    let w2: ReturnType<typeof result.current.acquire> = null
    act(() => {
      w1 = result.current.acquire()
      w2 = result.current.acquire()
    })
    expect(w1).not.toBeNull()
    expect(w2).not.toBeNull()

    // Third worker starts waiting (cannot acquire)
    const waiterPromise = result.current.acquireOrWait(2000)

    // First task finishes — worker releases key
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
      result.current.release(w1!.key)
    })

    // Third worker gets the released key (no timeout, no null)
    const w3 = await waiterPromise
    expect(w3).not.toBeNull()
    expect(w3!.key).toBe(w1!.key) // recycled
  })
})
