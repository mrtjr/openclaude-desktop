import { describe, it, expect } from 'vitest'
import { providerTimeoutMs } from '../electron/provider-timeouts.js'

describe('providerTimeoutMs', () => {
  it('gives Modal extra room for cold starts', () => {
    expect(providerTimeoutMs('modal')).toBe(180000)
  })

  it('uses a generous default for other providers', () => {
    expect(providerTimeoutMs('openai')).toBe(90000)
    expect(providerTimeoutMs('anthropic')).toBe(90000)
    expect(providerTimeoutMs('gemini')).toBe(90000)
    expect(providerTimeoutMs(undefined as any)).toBe(90000)
  })

  it('always exceeds the old fixed 60s (the spurious-timeout fix)', () => {
    for (const p of ['modal', 'openai', 'gemini', 'openrouter', 'custom']) {
      expect(providerTimeoutMs(p)).toBeGreaterThan(60000)
    }
  })
})
