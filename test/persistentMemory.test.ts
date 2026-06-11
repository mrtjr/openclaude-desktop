import { describe, it, expect } from 'vitest'
import { mergeFact, normalizeMemory, MEMORY_BUCKET_CAP } from '../src/utils/persistentMemory'

describe('normalizeMemory', () => {
  it('coerces partial/garbage input into the full shape', () => {
    expect(normalizeMemory(null)).toEqual({ facts: [], preferences: [], projects: [] })
    expect(normalizeMemory({ facts: ['a'] })).toEqual({ facts: ['a'], preferences: [], projects: [] })
    expect(normalizeMemory({ facts: 'nope' as any })).toEqual({ facts: [], preferences: [], projects: [] })
  })
})

describe('mergeFact', () => {
  it('adds a new value to the bucket for its category', () => {
    const r = mergeFact({ facts: [] }, 'fact', 'usa MetaTrader 5')
    expect(r.added).toBe(true)
    expect(r.bucket).toBe('facts')
    expect(r.memory.facts).toEqual(['usa MetaTrader 5'])
  })

  it('routes preference and project to the right buckets', () => {
    expect(mergeFact({}, 'preference', 'respostas curtas').memory.preferences).toEqual(['respostas curtas'])
    expect(mergeFact({}, 'project', 'robô scalper').memory.projects).toEqual(['robô scalper'])
  })

  it('falls back to facts for an unknown/missing category', () => {
    expect(mergeFact({}, undefined, 'x').bucket).toBe('facts')
    expect(mergeFact({}, 'lixo', 'x').bucket).toBe('facts')
  })

  it('dedupes case-insensitively and does not re-add', () => {
    const r = mergeFact({ facts: ['Usa MT5'] }, 'fact', '  usa mt5 ')
    expect(r.added).toBe(false)
    expect(r.memory.facts).toEqual(['Usa MT5'])
  })

  it('ignores empty/whitespace/non-string content', () => {
    expect(mergeFact({}, 'fact', '   ').added).toBe(false)
    expect(mergeFact({}, 'fact', 123 as any).added).toBe(false)
  })

  it('caps the bucket, dropping the oldest', () => {
    const facts = Array.from({ length: MEMORY_BUCKET_CAP }, (_, i) => `f${i}`)
    const r = mergeFact({ facts }, 'fact', 'novo')
    expect(r.added).toBe(true)
    expect(r.memory.facts.length).toBe(MEMORY_BUCKET_CAP)
    expect(r.memory.facts[0]).toBe('f1')           // f0 dropped
    expect(r.memory.facts[MEMORY_BUCKET_CAP - 1]).toBe('novo')
  })

  it('does not mutate the input store', () => {
    const input = { facts: ['a'], preferences: [], projects: [] }
    mergeFact(input, 'fact', 'b')
    expect(input.facts).toEqual(['a'])
  })
})
