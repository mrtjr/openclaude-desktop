import { describe, it, expect } from 'vitest'
import { cosineSim, rankBySimilarity } from '../src/utils/semanticMatch'

describe('cosineSim', () => {
  it('vetores idênticos → 1; ortogonais → 0', () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
    expect(cosineSim([1, 0], [0, 1])).toBe(0)
  })
  it('tamanhos diferentes ou vazio → 0', () => {
    expect(cosineSim([1, 2, 3], [1, 2])).toBe(0)
    expect(cosineSim([], [1])).toBe(0)
    expect(cosineSim([0, 0], [0, 0])).toBe(0)
  })
})

describe('rankBySimilarity', () => {
  const items = [
    { item: 'otserv', vec: [1, 0, 0] },
    { item: 'cozinha', vec: [0, 1, 0] },
    { item: 'tibia-server', vec: [0.9, 0.1, 0] },
  ]
  it('ordena por similaridade e filtra pelo piso', () => {
    const r = rankBySimilarity([1, 0, 0], items, 3, 0.6)
    expect(r.map(x => x.item)).toEqual(['otserv', 'tibia-server'])  // cozinha fica abaixo do piso
  })
  it('respeita o k', () => {
    expect(rankBySimilarity([1, 0, 0], items, 1, 0).length).toBe(1)
  })
  it('query vazia → []', () => {
    expect(rankBySimilarity([], items)).toEqual([])
  })
})
