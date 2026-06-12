import { describe, it, expect } from 'vitest'
import { formatClickResult } from '../src/utils/browserResult'

describe('formatClickResult', () => {
  it('reports a successful click (unchanged from before)', () => {
    expect(formatClickResult({ success: true, text: 'Enviar' }, '#btn')).toBe('Clicked: #btn (Enviar)')
    expect(formatClickResult({ success: true }, '#btn')).toBe('Clicked: #btn')
  })

  it('lists clickable candidates when the selector misses', () => {
    const out = formatClickResult({
      error: 'Element not found: #nope',
      candidates: [
        { selector: '#login', text: 'Entrar', tag: 'button' },
        { selector: '[data-oc-sel="occ1"]', text: '', tag: 'input' },
      ],
    }, '#nope')
    expect(out).toContain('Click error: Element not found: #nope')
    expect(out).toContain('- "Entrar" <button> → #login')
    expect(out).toContain('- "(sem texto)" <input> → [data-oc-sel="occ1"]')
  })

  it('falls back to a bare error when there are no candidates', () => {
    expect(formatClickResult({ error: 'Element not found: #x' }, '#x')).toBe('Click error: Element not found: #x')
    expect(formatClickResult({ error: 'boom', candidates: [] }, '#x')).toBe('Click error: boom')
  })
})
