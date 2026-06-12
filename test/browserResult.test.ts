import { describe, it, expect } from 'vitest'
import { formatClickResult, formatNavResult } from '../src/utils/browserResult'

describe('formatNavResult', () => {
  it('is byte-identical to the old formatter when there are no elements (zero regression)', () => {
    const r = { title: 'Exemplo', url: 'https://x.com', text: 'olá mundo' }
    expect(formatNavResult(r)).toBe('Navigated to: Exemplo\nURL: https://x.com\n\nPage content:\nolá mundo')
  })

  it('keeps the partial-load warning and empty-content fallback', () => {
    const out = formatNavResult({ title: 'T', url: 'u', partial: true, note: 'timeout' })
    expect(out).toContain('⚠️ Partial load: timeout')
    expect(out).toContain('Page content:\n(empty)')
  })

  it('appends an interactive-elements block when present', () => {
    const out = formatNavResult({
      title: 'Login', url: 'https://s.com', text: 'form',
      elements: {
        links: [{ text: 'Sobre', href: 'https://s.com/about' }],
        fields: [
          { tag: 'input', type: 'email', placeholder: 'Email', selector: '#email' },
          { tag: 'button', type: 'submit', placeholder: '', selector: '[data-oc-sel="ocn3"]' },
        ],
      },
    })
    expect(out).toContain('Interactive elements')
    expect(out).toContain('- "Sobre" → https://s.com/about')
    expect(out).toContain('- <input> type="email" placeholder="Email" → #email')
    expect(out).toContain('- <button> type="submit" → [data-oc-sel="ocn3"]')
  })

  it('omits the elements block when links and fields are both empty', () => {
    const out = formatNavResult({ title: 'T', url: 'u', text: 'x', elements: { links: [], fields: [] } })
    expect(out).not.toContain('Interactive elements')
  })
})

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
