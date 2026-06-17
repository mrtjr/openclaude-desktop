import { describe, it, expect } from 'vitest'
import {
  formatRagResults, buildRagRouterHint, RAG_MIN_SCORE, DEFAULT_RAG_EMBED_MODEL,
  type RagSearchHit,
} from '../src/utils/rag'

describe('formatRagResults', () => {
  const hits: RagSearchHit[] = [
    { text: 'O backtest roda com MT5 às 9h.', source: 'notas.md', score: 0.81 },
    { text: 'A estratégia usa média móvel de 200.', source: 'estrategia.pdf', score: 0.62 },
  ]

  it('formata trechos com fonte e score, instruindo a citar', () => {
    const out = formatRagResults(hits, 'como roda o backtest')
    expect(out).toContain('notas.md')
    expect(out).toContain('0.81')
    expect(out).toContain('cite a fonte')
    expect(out).toContain('[1]')
    expect(out).toContain('[2]')
  })

  it('descarta hits abaixo do piso de score (ruído)', () => {
    const noisy: RagSearchHit[] = [
      { text: 'relevante', source: 'a.md', score: 0.5 },
      { text: 'irrelevante', source: 'b.md', score: 0.05 },
    ]
    const out = formatRagResults(noisy, 'q')
    expect(out).toContain('relevante')
    expect(out).not.toContain('irrelevante')
  })

  it('sem hits relevantes → mensagem honesta de "nada indexado", não inventa', () => {
    const out = formatRagResults([], 'qualquer coisa')
    expect(out.toLowerCase()).toContain('nenhum trecho relevante')
    expect(out).toContain('qualquer coisa')
  })

  it('tolera entrada malformada (undefined, sem text/score)', () => {
    expect(() => formatRagResults(undefined, 'q')).not.toThrow()
    const out = formatRagResults([{ source: 'x' } as any, { text: '', source: 'y', score: 0.9 } as any], 'q')
    expect(out.toLowerCase()).toContain('nenhum trecho relevante')
  })

  it('o piso exportado é o usado por padrão', () => {
    const at = formatRagResults([{ text: 't', source: 's', score: RAG_MIN_SCORE }], 'q')
    const below = formatRagResults([{ text: 't', source: 's', score: RAG_MIN_SCORE - 0.01 }], 'q')
    expect(at).toContain('[1]')
    expect(below.toLowerCase()).toContain('nenhum trecho relevante')
  })
})

describe('buildRagRouterHint', () => {
  it('vazio quando não há índice (não instrui a usar a ferramenta à toa)', () => {
    expect(buildRagRouterHint({ count: 0, sources: [] }, 'pt')).toBe('')
    expect(buildRagRouterHint(null, 'pt')).toBe('')
    expect(buildRagRouterHint(undefined, 'en')).toBe('')
  })

  it('com índice: cita contagem, fontes e manda chamar rag_search primeiro (PT)', () => {
    const hint = buildRagRouterHint({ count: 12, sources: ['a.pdf', 'b.md'] }, 'pt')
    expect(hint).toContain('12')
    expect(hint).toContain('a.pdf')
    expect(hint).toContain('b.md')
    expect(hint).toContain('rag_search')
  })

  it('EN igualmente', () => {
    const hint = buildRagRouterHint({ count: 3, sources: ['x.txt'] }, 'en')
    expect(hint).toContain('rag_search')
    expect(hint).toContain('x.txt')
    expect(hint.toLowerCase()).toContain('knowledge base')
  })

  it('limita a 8 fontes e marca reticências quando há mais', () => {
    const sources = Array.from({ length: 12 }, (_, i) => `f${i}.md`)
    const hint = buildRagRouterHint({ count: 50, sources }, 'pt')
    expect(hint).toContain('f0.md')
    expect(hint).toContain('f7.md')
    expect(hint).not.toContain('f8.md')
    expect(hint).toContain('…')
  })
})

describe('DEFAULT_RAG_EMBED_MODEL', () => {
  it('casa com o default do RAGPanel', () => {
    expect(DEFAULT_RAG_EMBED_MODEL).toBe('mxbai-embed-large')
  })
})
