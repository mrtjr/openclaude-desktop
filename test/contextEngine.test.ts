// ─── ContextEngine tests ──────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  createContextEngine,
  getModelContextLimit,
  MODEL_CONTEXT_LIMITS,
} from '../src/services/contextEngine'
import type { Message } from '../src/types'

function msg(content: string, role: 'user' | 'assistant' = 'user'): Message {
  return { id: String(Math.random()), role, content, timestamp: new Date() } as Message
}

describe('createContextEngine', () => {
  const engine = createContextEngine()

  it('returns empty array for empty input', () => {
    expect(engine.assemble([], 1000)).toEqual([])
  })

  it('keeps all messages when they fit the budget', () => {
    const msgs = [msg('hi'), msg('there'), msg('friend')]
    const out = engine.assemble(msgs, 10_000)
    expect(out).toHaveLength(3)
  })

  it('walks back from newest when budget is tight', () => {
    // 10 messages of ~25 tokens each (100 chars ÷ 4 + 4 overhead)
    const msgs = Array.from({ length: 10 }, (_, i) => msg('x'.repeat(100) + i))
    const out = engine.assemble(msgs, 80) // ~3 messages worth
    expect(out.length).toBeLessThan(10)
    expect(out.length).toBeGreaterThan(0)
    // Most recent message must be included
    expect(out[out.length - 1]).toBe(msgs[9])
  })

  it('always keeps at least one message even with a tiny budget', () => {
    const msgs = [msg('x'.repeat(10_000))]
    const out = engine.assemble(msgs, 10)
    expect(out).toHaveLength(1) // at least the newest
  })

  it('getTokenCount sums across messages', () => {
    const a = engine.getTokenCount([msg('hello')])
    const b = engine.getTokenCount([msg('hello'), msg('world')])
    expect(b).toBeGreaterThan(a)
  })

  it('countTokens handles empty string', () => {
    expect(engine.countTokens('')).toBe(0)
  })

  it('countTokens treats CJK chars as denser than Latin', () => {
    const latin = engine.countTokens('a'.repeat(30))
    const cjk = engine.countTokens('文'.repeat(30))
    expect(cjk).toBeGreaterThan(latin)
  })
})

describe('getModelContextLimit', () => {
  it('returns exact match for known models', () => {
    expect(getModelContextLimit('gpt-4o')).toBe(128_000)
    expect(getModelContextLimit('claude-sonnet-4-20250514')).toBe(200_000)
  })

  it('falls back to partial match for versioned model ids', () => {
    expect(getModelContextLimit('gpt-4o-2024-08-06')).toBe(128_000)
  })

  it('returns safe default for unknown models', () => {
    expect(getModelContextLimit('some-random-local-model')).toBe(8_192)
  })

  it('covers all documented families', () => {
    // Guard rails: make sure we don't silently lose a model family
    expect(Object.keys(MODEL_CONTEXT_LIMITS).length).toBeGreaterThan(15)
  })
})
