import { describe, it, expect } from 'vitest'
import { hasMath, ensureKatex, isKatexReady, onKatexReady } from '../src/utils/katexLoader'
import { formatMarkdown } from '../src/utils/formatting'

describe('hasMath', () => {
  it('detects display math $$…$$', () => {
    expect(hasMath('Veja: $$\\int_0^1 x\\,dx$$ acima')).toBe(true)
  })

  it('detects inline math $…$', () => {
    expect(hasMath('a fórmula $x^2 + y^2$ é importante')).toBe(true)
    expect(hasMath('seja $n$ par')).toBe(true)
  })

  it('ignores currency / prose with lone dollars', () => {
    expect(hasMath('custa $5 e depois $10 no total')).toBe(false)
    expect(hasMath('apenas $5')).toBe(false)
    expect(hasMath('texto sem matemática nenhuma')).toBe(false)
  })

  it('does not treat inline math as spanning newlines', () => {
    expect(hasMath('$a\nb$')).toBe(false)
  })
})

describe('lazy KaTeX rendering', () => {
  const waitForKatex = () =>
    new Promise<void>((resolve) => {
      if (isKatexReady()) return resolve()
      const off = onKatexReady(() => {
        off()
        resolve()
      })
    })

  it('starts idle (nothing loaded at import time)', () => {
    expect(isKatexReady()).toBe(false)
  })

  it('renders math after lazy load, surviving the DOMPurify pass', async () => {
    ensureKatex()
    await waitForKatex()
    expect(isKatexReady()).toBe(true)
    const html = formatMarkdown('Equação: $x^2$')
    // KaTeX wraps output in <span class="katex">…; DOMPurify must keep it.
    expect(html).toContain('katex')
    expect(html).not.toContain('$x^2$') // the raw delimiters are gone
  })

  it('still renders plain Markdown normally', () => {
    expect(formatMarkdown('**oi**')).toContain('<strong>oi</strong>')
  })
})
