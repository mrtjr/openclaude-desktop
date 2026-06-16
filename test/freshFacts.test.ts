import { describe, it, expect } from 'vitest'
import {
  inferTtlDays, addFreshFact, isExpired, ageDays, pruneFreshFacts,
  recallFreshFacts, renderFreshFactsBlock, DEFAULT_TTL_DAYS, FRESH_FACTS_CAP,
  type FreshFact,
} from '../src/utils/freshFacts'

const at = (iso: string, ttlDays: number, text = 'fato', source?: string): FreshFact =>
  ({ text, source, verifiedAt: iso, ttlDays })

describe('inferTtlDays', () => {
  it('preços/notícias = 1d, versões/APIs = 30d, resto = padrão', () => {
    expect(inferTtlDays('preço atual do bitcoin')).toBe(1)
    expect(inferTtlDays('última versão do React')).toBe(30)
    expect(inferTtlDays('a capital da França')).toBe(DEFAULT_TTL_DAYS)
  })
})

describe('addFreshFact', () => {
  const now = new Date('2026-06-16T12:00:00.000Z')

  it('adiciona com verifiedAt e TTL inferido', () => {
    const { list, added } = addFreshFact([], { text: 'A última versão do React é a 20.2', source: 'https://react.dev' }, now)
    expect(added).toBe(true)
    expect(list[0].text).toBe('A última versão do React é a 20.2')
    expect(list[0].source).toBe('https://react.dev')
    expect(list[0].ttlDays).toBe(30) // contém "versão" → 30
    expect(list[0].verifiedAt).toBe(now.toISOString())
  })

  it('re-verificar o mesmo fato substitui (atualiza data), não duplica', () => {
    const older = [at('2026-01-01T00:00:00.000Z', 30, 'React 20.2 é a última')]
    const { list } = addFreshFact(older, { text: '  react 20.2 é a última ' }, now)
    expect(list.length).toBe(1)
    expect(list[0].verifiedAt).toBe(now.toISOString())
  })

  it('respeita ttl_days explícito e ignora conteúdo vazio', () => {
    expect(addFreshFact([], { text: 'x', ttlDays: 7 }, now).list[0].ttlDays).toBe(7)
    expect(addFreshFact([], { text: '   ' }, now).added).toBe(false)
  })

  it('aplica o cap descartando o mais antigo', () => {
    const many = Array.from({ length: FRESH_FACTS_CAP }, (_, i) => at(now.toISOString(), 14, `f${i}`))
    const { list } = addFreshFact(many, { text: 'novo' }, now)
    expect(list.length).toBe(FRESH_FACTS_CAP)
    expect(list[list.length - 1].text).toBe('novo')
    expect(list.find(f => f.text === 'f0')).toBeUndefined()
  })
})

describe('isExpired / ageDays', () => {
  const now = new Date('2026-06-16T00:00:00.000Z')
  it('marca vencido após o TTL', () => {
    expect(isExpired(at('2026-06-15T00:00:00.000Z', 30), now)).toBe(false)
    expect(isExpired(at('2026-05-01T00:00:00.000Z', 14), now)).toBe(true)
    expect(Math.round(ageDays(at('2026-06-06T00:00:00.000Z', 14), now))).toBe(10)
  })
})

describe('pruneFreshFacts', () => {
  const now = new Date('2026-06-16T00:00:00.000Z')
  it('remove o que passou de TTL*grace, mantém recém-vencidos', () => {
    const list = [
      at('2026-06-15T00:00:00.000Z', 30, 'fresco'),       // idade 1d, ok
      at('2026-06-01T00:00:00.000Z', 14, 'recem-vencido'), // idade 15d, TTL 14, <28 → mantém
      at('2026-01-01T00:00:00.000Z', 14, 'muito-velho'),   // idade ~166d > 28 → remove
    ]
    const kept = pruneFreshFacts(list, now).map(f => f.text)
    expect(kept).toContain('fresco')
    expect(kept).toContain('recem-vencido')
    expect(kept).not.toContain('muito-velho')
  })
})

describe('recallFreshFacts', () => {
  const now = new Date('2026-06-16T00:00:00.000Z')
  const list = [
    at('2026-06-15T00:00:00.000Z', 30, 'A última versão do React é a 20.2'),
    at('2026-05-01T00:00:00.000Z', 14, 'O preço do bitcoin estava em 100k'),
    at('2026-06-15T00:00:00.000Z', 30, 'O Vite atual é o 7'),
    // Armadilha de stopword: compartilha só "como"/"atual" com consultas comuns,
    // nenhuma palavra de conteúdo — não pode casar por acaso (regressão NEW-1).
    at('2026-06-15T00:00:00.000Z', 30, 'Como atualizar o firmware do roteador'),
  ]
  it('casa por sobreposição de palavras e separa fresco vs vencido', () => {
    const r = recallFreshFacts(list, 'qual a versão do react agora?', now)
    expect(r.fresh.some(f => f.text.includes('React'))).toBe(true)
    expect(r.fresh.some(f => f.text.includes('Vite'))).toBe(false)
    expect(r.fresh.some(f => f.text.includes('roteador'))).toBe(false)
  })
  it('fato vencido cai em stale', () => {
    const r = recallFreshFacts(list, 'preço do bitcoin', now)
    expect(r.stale.some(f => f.text.includes('bitcoin'))).toBe(true)
    expect(r.fresh.length).toBe(0)
  })
  it('sem sobreposição de conteúdo → vazio (stopword não casa)', () => {
    // "como" casa textualmente com o fato do roteador, mas é stopword → ignorado.
    const r = recallFreshFacts(list, 'como fazer um bolo de cenoura', now)
    expect(r.fresh.length + r.stale.length).toBe(0)
  })
  it('consulta só com stopwords/palavras-curtas → vazio', () => {
    const r = recallFreshFacts(list, 'qual é o atual agora?', now)
    expect(r.fresh.length + r.stale.length).toBe(0)
  })
})

describe('renderFreshFactsBlock', () => {
  const now = new Date('2026-06-16T00:00:00.000Z')
  it('rende frescos e marca vencidos como re-verificar', () => {
    const fresh = [at('2026-06-14T00:00:00.000Z', 30, 'React 20.2', 'https://react.dev')]
    const stale = [at('2026-05-01T00:00:00.000Z', 14, 'BTC 100k')]
    const block = renderFreshFactsBlock(fresh, stale, 'pt', now)
    expect(block).toContain('React 20.2')
    expect(block).toContain('https://react.dev')
    expect(block).toContain('verificado há')
    expect(block.toLowerCase()).toContain('desatualizado')
    expect(block).toContain('BTC 100k')
  })
  it('vazio quando não há nada', () => {
    expect(renderFreshFactsBlock([], [], 'pt', now)).toBe('')
  })
  it('verifiedAt inválido → "data desconhecida", nunca "Infinityd" (regressão NEW-2)', () => {
    const ruim = [at('não-é-data', 14, 'fato com data quebrada')]
    const block = renderFreshFactsBlock([], ruim, 'pt', now)
    expect(block).toContain('fato com data quebrada')
    expect(block).toContain('data desconhecida')
    expect(block).not.toContain('Infinity')
    const en = renderFreshFactsBlock([], ruim, 'en', now)
    expect(en).toContain('unknown date')
    expect(en).not.toContain('Infinity')
  })
})
