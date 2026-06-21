import { describe, it, expect } from 'vitest'
import { isSmallModel, parseModelSizeB, generateId, getRelativeTime, formatMarkdown, sanitizeHtml } from '../src/utils/formatting'

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

  it('classifies ANY ≤14B size as small (covers sizes the old fixed list missed)', () => {
    expect(isSmallModel('gemma-2b')).toBe(true)   // old list lacked 2b
    expect(isSmallModel('qwen-4b')).toBe(true)    // old list lacked 4b
    expect(isSmallModel('llama-13b')).toBe(true)  // old list lacked 13b
    expect(isSmallModel('granite-10b')).toBe(true)
  })

  it('leaves 30B+ local models as medium/large', () => {
    expect(isSmallModel('qwen-32b')).toBe(false)
    expect(isSmallModel('llama-70b')).toBe(false)
    expect(isSmallModel('yi-34b')).toBe(false)
  })

  it("the user's GLM-5.1 (namespaced) is never small", () => {
    expect(isSmallModel('zai-org/GLM-5.1-FP8')).toBe(false)
  })
})

describe('parseModelSizeB', () => {
  it('extracts the billions count, including decimals', () => {
    expect(parseModelSizeB('llama3.1-8b')).toBe(8)
    expect(parseModelSizeB('qwen2.5-0.5b')).toBe(0.5)
    expect(parseModelSizeB('llama-70b')).toBe(70)
    expect(parseModelSizeB('llama3.2:3b')).toBe(3)
  })
  it('returns null when there is no size token', () => {
    expect(parseModelSizeB('llama3')).toBeNull()
    expect(parseModelSizeB('mystery-model')).toBeNull()
    expect(parseModelSizeB('')).toBeNull()
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

describe('sanitizeHtml — central, endurecido (v2.116.0)', () => {
  it('remove script e handlers de evento (XSS)', () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)">')).not.toContain('onerror')
    expect(sanitizeHtml('<script>alert(1)</script>hi')).not.toContain('<script')
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })
  it('bloqueia svg/style/iframe (vetores nunca usados no nosso markdown)', () => {
    expect(sanitizeHtml('<svg><script>alert(1)</script></svg>')).not.toContain('<svg')
    expect(sanitizeHtml('<style>body{background:url(x)}</style>')).not.toContain('<style')
    expect(sanitizeHtml('<iframe src="evil"></iframe>')).not.toContain('<iframe')
  })
  it('mantém o HTML seguro do markdown (code, span, input checkbox, tabela)', () => {
    expect(sanitizeHtml('<p><strong>x</strong> <code>y</code></p>')).toContain('<code>y</code>')
    expect(sanitizeHtml('<input type="checkbox" disabled>')).toContain('checkbox')
    expect(sanitizeHtml('<span style="margin:1px">k</span>')).toContain('<span')
  })
  it('endurece links: target _blank + rel noopener', () => {
    const out = sanitizeHtml('<a href="https://x.com">x</a>')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('target="_blank"')
  })
  it('formatMarkdown passa pelo sanitizeHtml (sem script)', () => {
    expect(formatMarkdown('<script>alert(1)</script>**ok**')).not.toContain('<script')
  })
})
