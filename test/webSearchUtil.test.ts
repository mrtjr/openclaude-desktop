import { describe, it, expect } from 'vitest'
import { normalizeUrl, domainOf, dedupeResults, formatResults, cacheKey, isFresh } from '../electron/web-search-util.js'

describe('normalizeUrl', () => {
  it('strips protocol, www, query, fragment and trailing slash', () => {
    expect(normalizeUrl('https://www.Example.com/Path/?q=1#frag')).toBe('example.com/path')
    expect(normalizeUrl('http://example.com/')).toBe('example.com')
    expect(normalizeUrl('https://EXAMPLE.com')).toBe('example.com')
  })
  it('handles empty / missing input', () => {
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl(undefined as any)).toBe('')
  })
})

describe('domainOf', () => {
  it('returns the host without www', () => {
    expect(domainOf('https://www.ceasa.gov.br/precos/abobora')).toBe('ceasa.gov.br')
    expect(domainOf('http://sub.example.com/x')).toBe('sub.example.com')
  })
})

describe('dedupeResults', () => {
  it('collapses URLs that point at the same page, keeping first + order', () => {
    const out = dedupeResults([
      { title: 'A', url: 'https://example.com/p' },
      { title: 'A dup', url: 'http://www.example.com/p/' },     // same page
      { title: 'B', url: 'https://other.com/x?utm=1' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('A')
    expect(out[1].title).toBe('B')
  })
  it('drops entries missing a title or url', () => {
    const out = dedupeResults([
      { title: '', url: 'https://x.com' },
      { title: 'No url', url: '' },
      { title: 'ok', url: 'https://y.com' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('ok')
  })
  it('handles empty / nullish input', () => {
    expect(dedupeResults([])).toEqual([])
    expect(dedupeResults(undefined as any)).toEqual([])
  })
})

describe('formatResults', () => {
  it('renders numbered, clickable markdown links with domain', () => {
    const out = formatResults('abobora', [
      { title: 'Preço CEASA', url: 'https://www.ceasa.gov.br/x', snippet: 'R$ 3,50/kg' },
    ])
    expect(out).toContain('1. [Preço CEASA](https://www.ceasa.gov.br/x)')
    expect(out).toContain('ceasa.gov.br')
    expect(out).toContain('R$ 3,50/kg')
    expect(out).toContain('(1 fonte)')
  })
  it('pluralizes the source count', () => {
    const out = formatResults('q', [
      { title: 'A', url: 'https://a.com' },
      { title: 'B', url: 'https://b.com' },
    ])
    expect(out).toContain('(2 fontes)')
  })
  it('returns a no-results message when empty', () => {
    expect(formatResults('nada', [])).toBe('Sem resultados para "nada".')
  })
})

describe('cacheKey', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(cacheKey('  Preço  Abóbora ')).toBe('preço abóbora')
    expect(cacheKey('PREÇO ABÓBORA')).toBe(cacheKey('preço abóbora'))
  })
})

describe('isFresh', () => {
  it('is true within the TTL and false outside it', () => {
    const now = 1_000_000
    expect(isFresh({ ts: now - 1000 }, now, 5000)).toBe(true)
    expect(isFresh({ ts: now - 6000 }, now, 5000)).toBe(false)
  })
  it('is false for a missing / malformed entry', () => {
    expect(isFresh(undefined, 1000, 5000)).toBe(false)
    expect(isFresh({} as any, 1000, 5000)).toBe(false)
  })
})
