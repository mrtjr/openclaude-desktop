import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { providerTimeoutMs, createStallWatchdog } from '../electron/provider-timeouts.js'

describe('providerTimeoutMs — connect phase (first byte / cold start)', () => {
  it('gives Modal generous room for a GPU cold start', () => {
    expect(providerTimeoutMs('modal')).toBe(300000)
    expect(providerTimeoutMs('modal', 'connect')).toBe(300000)
  })

  it('uses a generous default for other providers', () => {
    expect(providerTimeoutMs('openai')).toBe(120000)
    expect(providerTimeoutMs('anthropic')).toBe(120000)
    expect(providerTimeoutMs('gemini')).toBe(120000)
    expect(providerTimeoutMs(undefined as any)).toBe(120000)
  })

  it('defaults to the connect phase when none is given', () => {
    expect(providerTimeoutMs('modal')).toBe(providerTimeoutMs('modal', 'connect'))
  })
})

describe('providerTimeoutMs — stream phase (idle gap once flowing)', () => {
  it('is tighter than connect, so a mid-stream stall is caught sooner', () => {
    expect(providerTimeoutMs('modal', 'stream')).toBe(150000)
    expect(providerTimeoutMs('openai', 'stream')).toBe(90000)
    expect(providerTimeoutMs('modal', 'stream')).toBeLessThan(providerTimeoutMs('modal', 'connect'))
    expect(providerTimeoutMs('openai', 'stream')).toBeLessThan(providerTimeoutMs('openai', 'connect'))
  })

  it('still gives Modal more room than other providers in both phases', () => {
    expect(providerTimeoutMs('modal', 'connect')).toBeGreaterThan(providerTimeoutMs('openai', 'connect'))
    expect(providerTimeoutMs('modal', 'stream')).toBeGreaterThan(providerTimeoutMs('openai', 'stream'))
  })
})

describe('providerTimeoutMs — invariants', () => {
  it('every value still exceeds the old fixed 60s (the spurious-timeout fix)', () => {
    for (const p of ['modal', 'openai', 'gemini', 'openrouter', 'custom']) {
      expect(providerTimeoutMs(p, 'connect')).toBeGreaterThan(60000)
      expect(providerTimeoutMs(p, 'stream')).toBeGreaterThan(60000)
    }
  })

  it('modal cold-start budget is at least the previous 180s (never a regression)', () => {
    expect(providerTimeoutMs('modal', 'connect')).toBeGreaterThanOrEqual(180000)
  })
})

describe('createStallWatchdog — content-level stall detection', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires onStall when no content arrives within the budget', () => {
    const onStall = vi.fn()
    createStallWatchdog(90000, onStall)
    vi.advanceTimersByTime(89999)
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('touch() resets the budget — a flowing stream never stalls', () => {
    const onStall = vi.fn()
    const wd = createStallWatchdog(90000, onStall)
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(60000) // chunks every 60s, under the 90s budget
      wd.touch()
    }
    expect(onStall).not.toHaveBeenCalled()
    // ...but once content stops (even with socket keep-alives that never
    // reach touch()), the watchdog still fires — the exact frozen-cursor bug.
    vi.advanceTimersByTime(90000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('stop() disarms it for good — done/error paths cannot fire a late stall', () => {
    const onStall = vi.fn()
    const wd = createStallWatchdog(90000, onStall)
    wd.stop()
    vi.advanceTimersByTime(300000)
    expect(onStall).not.toHaveBeenCalled()
    wd.touch() // touch after stop must not re-arm
    vi.advanceTimersByTime(300000)
    expect(onStall).not.toHaveBeenCalled()
  })

  it('fires at most once even without stop()', () => {
    const onStall = vi.fn()
    const wd = createStallWatchdog(1000, onStall)
    vi.advanceTimersByTime(5000)
    wd.touch() // late touch after firing must not re-arm
    vi.advanceTimersByTime(5000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })
})
