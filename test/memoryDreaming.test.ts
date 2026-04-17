import { describe, it, expect } from 'vitest'
import {
  calculateHealth,
  updateHealthScores,
  lightDream,
  deepDream,
  shouldDream,
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
