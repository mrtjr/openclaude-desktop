import { describe, it, expect } from 'vitest'
import { extractSources, collectSources, normalizeSourceUrl, domainOf } from '../src/utils/sources'

describe('normalizeSourceUrl / domainOf', () => {
  it('normaliza p/ dedupe e extrai domínio', () => {
    expect(normalizeSourceUrl('https://www.Example.com/Path/?q=1#x')).toBe('example.com/path')
    expect(domainOf('https://www.ceasa.gov.br/precos')).toBe('ceasa.gov.br')
  })
})

describe('extractSources', () => {
  it('lê links markdown (formato do web_search)', () => {
    const txt = 'Resultados (2 fontes):\n\n1. [Título A](https://a.com/x) — a.com\n2. [Título B](https://b.com) — b.com'
    expect(extractSources(txt)).toEqual([
      { title: 'Título A', url: 'https://a.com/x' },
      { title: 'Título B', url: 'https://b.com' },
    ])
  })

  it('lê linhas URL: (formato do fetch_url)', () => {
    expect(extractSources('Navigated to: Página\nURL: https://c.com/doc\n\nPage content: ...')).toEqual([
      { title: 'c.com', url: 'https://c.com/doc' },
    ])
  })
})

describe('collectSources', () => {
  it('só considera ferramentas de fonte, deduplica e respeita o cap', () => {
    const items = [
      { name: 'web_search', result: '1. [A](https://a.com) 2. [B](https://b.com)' },
      { name: 'fetch_url', args: { url: 'https://a.com/' }, result: 'conteúdo sem link' }, // dup de A
      { name: 'read_file', result: '[ignora](https://nope.com)' }, // não é fonte
      { name: 'fetch_url', args: { url: 'https://c.com' }, result: '' },
    ]
    expect(collectSources(items)).toEqual([
      { title: 'A', url: 'https://a.com' },
      { title: 'B', url: 'https://b.com' },
      { title: 'c.com', url: 'https://c.com' },
    ])
  })

  it('cap em max', () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ name: 'web_search', result: `[t${i}](https://s${i}.com)` }))
    expect(collectSources(big, 5)).toHaveLength(5)
  })
})
