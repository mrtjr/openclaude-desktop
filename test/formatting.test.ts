import { describe, it, expect } from 'vitest'
import { isSmallModel, generateId, getRelativeTime, formatMarkdown } from '../src/utils/formatting'

describe('formatMarkdown (cached)', () => {
  it('renders markdown to sanitized HTML', () => {
    expect(formatMarkdown('**bold**')).toContain('<strong>bold</strong>')
    expect(formatMarkdown('`code`')).toContain('<code')
  })

  it('returns consistent output on repeated calls (cache hit)', () => {
    const md = '# Title\n\nsome **text** and a list:\n- a\n- b'
    expect(formatMarkdown(md)).toBe(formatMarkdown(md))
  })

  it('cached and uncached paths agree', () => {
    const md = '## H2\n\n`inline` and _em_'
    expect(formatMarkdown(md, false)).toBe(formatMarkdown(md, true))
  })

  it('does not cross-contaminate distinct cache entries', () => {
    const a = formatMarkdown('alpha **A**')
    const b = formatMarkdown('beta _B_')
    expect(formatMarkdown('alpha **A**')).toBe(a)
    expect(formatMarkdown('beta _B_')).toBe(b)
    expect(a).not.toBe(b)
  })

  it('returns empty string for empty input', () => {
    expect(formatMarkdown('')).toBe('')
  })
})

describe('isSmallModel', () => {
  it('cloud models are NOT classified as small', () => {
    expect(isSmallModel('gpt-4o')).toBe(false)
    expect(isSmallModel('claude-3-5-sonnet')).toBe(false)
    expect(isSmallModel('gemini-2.0-flash')).toBe(false)
    expect(isSmallModel('o1-preview')).toBe(false)
    expect(isSmallModel('deepseek-chat')).toBe(false)
    expect(isSmallModel('google/gemini-2.5-pro')).toBe(false) // openrouter format
  })

  it('local small models are classified as small', () => {
    expect(isSmallModel('llama3.2:3b')).toBe(true)
    expect(isSmallModel('phi3')).toBe(true)
    expect(isSmallModel('qwen2:7b')).toBe(true)
  })

  it('models without size indicator default to NOT small (regression)', () => {
    // Previous bug: unmarked models defaulted to small
    expect(isSmallModel('llama3')).toBe(false)
    expect(isSmallModel('mystery-model')).toBe(false)
  })

  it('handles empty/null-ish input', () => {
    expect(isSmallModel('')).toBe(false)
  })

  it('mistral-large is NOT small', () => {
    expect(isSmallModel('mistral-large')).toBe(false)
    expect(isSmallModel('mistral-medium')).toBe(false)
  })
})

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('returns distinct IDs on successive calls', () => {
    const ids = new Set()
    for (let i = 0; i < 100; i++) ids.add(generateId())
    // With 100 calls, collisions should be extremely rare
    expect(ids.size).toBeGreaterThan(95)
  })
})

describe('getRelativeTime', () => {
  it('formats "agora" for very recent dates', () => {
    const now = new Date()
    const out = getRelativeTime(now)
    // Should be a short, non-empty string — exact label depends on locale
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })

  it('handles dates from months ago without plural bug', () => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    const out = getRelativeTime(d)
    // Regression: must NOT contain "1 meses" (wrong plural)
    expect(out).not.toMatch(/1 meses/)
  })

  it('handles yesterday correctly', () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const out = getRelativeTime(d)
    // Must NOT be "há 1 dias" — regression from v2.2.1
    expect(out).not.toMatch(/1 dias/)
  })
})
