import { describe, it, expect } from 'vitest'
import {
  calculateHealth,
  updateHealthScores,
  lightDream,
  deepDream,
  shouldDream,
  factsContradict,
  decideConsolidationOp,
  type AgentMemory,
} from '../src/services/memoryDreaming'

const DAY = 24 * 60 * 60 * 1000

function makeMemory(overrides: Partial<AgentMemory> = {}): AgentMemory {
  return {
    workingMemory: [],
    episodic: [],
    consolidated: [],
    lastDreamTime: 0,
    ...overrides,
  } as AgentMemory
}

describe('calculateHealth', () => {
  it('returns ~1 for memory updated right now', () => {
    const h = calculateHealth(Date.now())
    expect(h).toBeGreaterThan(0.99)
  })

  it('halves after one half-life (7 days)', () => {
    const now = Date.now()
    const h = calculateHealth(now - 7 * DAY, now)
    expect(h).toBeCloseTo(0.5, 2)
  })

  it('clamps to a minimum (never returns 0)', () => {
    const now = Date.now()
    const h = calculateHealth(now - 365 * DAY, now)
    expect(h).toBeGreaterThan(0)
  })
})

describe('updateHealthScores', () => {
  it('assigns a health field to every working memory entry', () => {
    const now = Date.now()
    const m = makeMemory({
      workingMemory: [
        { id: '1', content: 'a', updatedAt: now, createdAt: now } as any,
        { id: '2', content: 'b', updatedAt: now - 14 * DAY, createdAt: now } as any,
      ],
    })
    const out = updateHealthScores(m)
    expect(out.workingMemory[0].health).toBeGreaterThan(0.99)
    expect(out.workingMemory[1].health).toBeLessThan(0.3)
  })
})

describe('lightDream', () => {
  it('is a no-op when no unconsolidated episodes exist', () => {
    const m = makeMemory({ episodic: [{ consolidated: true } as any] })
    const out = lightDream(m)
    expect(out).toBe(m)
  })

  it('promotes unconsolidated episode summaries into consolidated facts', () => {
    const m = makeMemory({
      episodic: [
        { consolidated: false, summary: 'user likes TypeScript', conversationId: 'c1', timestamp: Date.now() } as any,
      ],
    })
    const out = lightDream(m)
    expect(out.consolidated?.length).toBeGreaterThanOrEqual(1)
    expect(out.episodic[0].consolidated).toBe(true)
    expect(out.lastDreamTime).toBeGreaterThan(0)
  })
})

describe('anti-drift — contradição (Fase 1, v2.52.0)', () => {
  const A = 'o melhor caminho para pentest em otserv e explorar a porta do login primeiro'
  const B = 'o melhor caminho para pentest em otserv nao e explorar a porta do login primeiro'

  it('factsContradict: polaridade de negação diferente', () => {
    expect(factsContradict(A, B)).toBe(true)
    expect(factsContradict('o servidor e seguro', 'o servidor nao e seguro')).toBe(true)
  })
  it('factsContradict: números conflitantes', () => {
    expect(factsContradict('usa a porta 7171', 'usa a porta 7172')).toBe(true)
  })
  it('factsContradict: fatos concordantes → false', () => {
    expect(factsContradict('user likes typescript', 'user likes typescript')).toBe(false)
    expect(factsContradict('roda na porta 7171', 'roda na porta 7171 com tls')).toBe(false)
  })
  it('decideConsolidationOp: confirm vs update', () => {
    const mk = (fact: string, lastSeen = 1) => ({ fact, confidence: 0.8, sources: ['c'], createdAt: 1, lastSeen })
    expect(decideConsolidationOp(mk(A) as any, mk(A) as any)).toBe('confirm')
    expect(decideConsolidationOp(mk(A) as any, mk(B) as any)).toBe('update')
  })

  it('lightDream: fato contraditório NÃO empilha — o mais novo vence e a confiança cai', () => {
    const m = makeMemory({
      consolidated: [{ fact: A, confidence: 0.8, sources: ['c1'], createdAt: 1, lastSeen: 1 }] as any,
      episodic: [{ consolidated: false, summary: B, conversationId: 'c2', timestamp: 100 } as any],
    })
    const out = lightDream(m)
    const aboutOtserv = (out.consolidated || []).filter(c => c.fact.includes('otserv'))
    expect(aboutOtserv.length).toBe(1)            // não duplicou o contraditório
    expect(aboutOtserv[0].fact).toContain('nao')  // o mais novo venceu
    expect(aboutOtserv[0].confidence).toBeLessThan(0.8) // confiança rebaixada
    expect(aboutOtserv[0].sources).toContain('c1') // mantém as fontes
    expect(aboutOtserv[0].sources).toContain('c2')
  })

  it('lightDream: fato concordante reforça a confiança (sem duplicar)', () => {
    const fact = 'o usuario prefere typescript com tipos explicitos em todo o codigo'
    const m = makeMemory({
      consolidated: [{ fact, confidence: 0.8, sources: ['c1'], createdAt: 1, lastSeen: 1 }] as any,
      episodic: [{ consolidated: false, summary: fact, conversationId: 'c2', timestamp: 100 } as any],
    })
    const out = lightDream(m)
    const same = (out.consolidated || []).filter(c => c.fact === fact)
    expect(same.length).toBe(1)
    expect(same[0].confidence).toBeGreaterThan(0.8)
  })
})

describe('deepDream', () => {
  it('prunes low-health working memory entries', () => {
    const now = Date.now()
    const m = makeMemory({
      workingMemory: [
        { id: 'recent', content: 'fresh', updatedAt: now, createdAt: now } as any,
        { id: 'ancient', content: 'stale', updatedAt: now - 60 * DAY, createdAt: now } as any,
      ],
    })
    const out = deepDream(m)
    const ids = out.workingMemory.map(e => e.id)
    expect(ids).toContain('recent')
    expect(ids).not.toContain('ancient')
  })
})

describe('shouldDream', () => {
  it('returns true for light dream when never dreamed before', () => {
    const m = makeMemory({ episodic: [{ consolidated: false } as any] })
    expect(shouldDream(m, 'light')).toBe(true)
  })

  it('returns false for light dream when there is nothing unconsolidated', () => {
    const m = makeMemory({ lastDreamTime: Date.now() - DAY })
    // no episodic items → nothing to dream about
    expect(shouldDream(m, 'light')).toBe(false)
  })
})
