import { describe, it, expect } from 'vitest'
import {
  extractPreferenceCandidates, recordCandidates, selectPromotable, removeCandidates,
  PREF_MIN_SOURCES, type PrefCandidateStore,
} from '../src/utils/preferenceLearning'

describe('extractPreferenceCandidates', () => {
  it('captura preferências explícitas (PT)', () => {
    expect(extractPreferenceCandidates('Eu prefiro respostas curtas e diretas.')).toEqual(['Eu prefiro respostas curtas e diretas'])
    expect(extractPreferenceCandidates('De agora em diante, responda sempre em português.').length).toBe(1)
  })
  it('captura preferências explícitas (EN)', () => {
    expect(extractPreferenceCandidates('From now on, always use tabs not spaces').length).toBe(1)
    expect(extractPreferenceCandidates("I prefer concise answers").length).toBe(1)
  })
  it('ignora perguntas e frases normais', () => {
    expect(extractPreferenceCandidates('Qual você prefere?')).toEqual([])
    expect(extractPreferenceCandidates('O sol sempre nasce no leste.')).toEqual([])
    expect(extractPreferenceCandidates('Como faço um loop em JS?')).toEqual([])
  })
  it('lida com vazio e cap de 3 por mensagem', () => {
    expect(extractPreferenceCandidates('')).toEqual([])
    const many = 'Eu prefiro A. Eu prefiro B. Eu prefiro C. Eu prefiro D.'
    expect(extractPreferenceCandidates(many).length).toBe(3)
  })
})

describe('recordCandidates + selectPromotable', () => {
  it('só promove após reforço em ≥ minSources conversas distintas', () => {
    let store: PrefCandidateStore = {}
    store = recordCandidates(store, ['prefiro respostas curtas'], 'c1', 1)
    expect(selectPromotable(store)).toEqual([])              // 1 fonte → ainda não
    store = recordCandidates(store, ['prefiro respostas curtas'], 'c2', 2)
    expect(selectPromotable(store)).toEqual(['prefiro respostas curtas']) // 2 fontes → promove
  })
  it('repetir na MESMA conversa não infla as fontes (anti-falso-positivo)', () => {
    let store: PrefCandidateStore = {}
    store = recordCandidates(store, ['use sempre tabs'], 'c1', 1)
    store = recordCandidates(store, ['use sempre tabs'], 'c1', 2)
    expect(store['use sempre tabs'].sources.length).toBe(1)
    // mas count alto na mesma conversa promove pelo fallback (count >= minSources+1)
    store = recordCandidates(store, ['use sempre tabs'], 'c1', 3)
    expect(selectPromotable(store, { minSources: PREF_MIN_SOURCES })).toContain('use sempre tabs')
  })
  it('removeCandidates tira as promovidas', () => {
    let store: PrefCandidateStore = {}
    store = recordCandidates(store, ['x'], 'c1', 1)
    store = removeCandidates(store, ['X'])  // case-insensitive
    expect(Object.keys(store)).toEqual([])
  })
})
