import { describe, it, expect } from 'vitest'
import { resolveTurnUsage } from '../src/utils/usage'

describe('resolveTurnUsage', () => {
  const msgs = [{ content: 'hello world' }, { content: 'foo bar baz' }]

  it('prefers provider usage (prompt_tokens / completion_tokens)', () => {
    expect(resolveTurnUsage({ prompt_tokens: 123, completion_tokens: 45 }, msgs, 'out'))
      .toEqual({ inputTokens: 123, outputTokens: 45 })
  })

  it('accepts Anthropic-style input_tokens / output_tokens aliases', () => {
    expect(resolveTurnUsage({ input_tokens: 10, output_tokens: 20 }, msgs, 'out'))
      .toEqual({ inputTokens: 10, outputTokens: 20 })
  })

  it('estimates from messages + output when provider usage is absent', () => {
    const u = resolveTurnUsage(null, msgs, 'some output text here')
    expect(u.inputTokens).toBeGreaterThan(0)
    expect(u.outputTokens).toBeGreaterThan(0)
  })

  it('counts non-string message content via JSON length', () => {
    const u = resolveTurnUsage(undefined, [{ content: { a: 1, b: [2, 3, 4] } }], '')
    expect(u.inputTokens).toBeGreaterThan(0)
    expect(u.outputTokens).toBe(0)
  })

  it('falls back to an estimate when provider usage is partial (one field missing)', () => {
    const u = resolveTurnUsage({ prompt_tokens: 100 }, msgs, 'out')
    expect(u.inputTokens).toBeGreaterThan(0)
    expect(u.inputTokens).not.toBe(100) // didn't trust a half-reported usage
  })

  it('handles empty output without error', () => {
    expect(resolveTurnUsage(null, msgs, '').outputTokens).toBe(0)
  })
})
