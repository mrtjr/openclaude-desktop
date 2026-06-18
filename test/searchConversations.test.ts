import { describe, it, expect } from 'vitest'
import {
  queryTerms, snippetAround, searchConversations, formatConversationMatches, foldWithMap,
  type ConversationLike,
} from '../src/utils/searchConversations'

const NOW = new Date('2026-06-17T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).getTime()

// Marca combinante "acute" (U+0301) montada por code-point para manter o SOURCE
// em ASCII puro (sem glifo acentuado, que normaliza de forma imprevisível).
const ACUTE = String.fromCharCode(0x0301)

const convs: ConversationLike[] = [
  { id: 'c1', title: 'Backtest MT5', createdAt: day(2), messages: [
    { role: 'user', content: 'Como configurar o backtest no MetaTrader 5?' },
    { role: 'assistant', content: 'Use o Strategy Tester com média móvel de 200 períodos.' },
  ] },
  { id: 'c2', title: 'Deploy Vite', createdAt: day(10), messages: [
    { role: 'user', content: 'Erro no deploy do app Vite na Vercel' },
  ] },
  { id: 'atual', title: 'Conversa atual', createdAt: day(0), messages: [
    { role: 'user', content: 'backtest de novo' },
  ] },
]

describe('queryTerms', () => {
  it('tokeniza, normaliza acento, descarta <2 chars e duplicatas', () => {
    expect(queryTerms('Configuração do backtest, backtest!')).toEqual(['configuracao', 'do', 'backtest'])
  })
})

describe('foldWithMap', () => {
  it('mapeia cada indice dobrado de volta ao indice no texto ORIGINAL', () => {
    // 'e' + acute combinante = "e-acento" DECOMPOSTO (2 unidades) -> dobra p/ 'e'
    // (1 unidade): o resultado encurta, entao os indices divergem do original.
    const input = 'cafe' + ACUTE + 'X' // c,a,f,e,combinante,X = 6 unidades
    const { low, map } = foldWithMap(input)
    expect(low).toBe('cafex')              // sem acento, lowercase, marca solta sumiu
    expect(low.length).toBe(map.length)
    // 'X' original esta no indice 5; no dobrado ('x') no 4 -> map[4] = 5
    expect(map[low.indexOf('x')]).toBe(5)
  })
})

describe('snippetAround', () => {
  it('recorta ao redor do termo com reticências', () => {
    const s = snippetAround('x'.repeat(200) + ' média móvel ' + 'y'.repeat(200), ['media'], 60)
    expect(s).toContain('média móvel')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
  })

  it('alinha o recorte mesmo com marcas combinantes antes do termo (nao desloca)', () => {
    // prefixo LONGO com acento DECOMPOSTO: cada grupo encolhe na dobra, entao o
    // indice dobrado diverge muito do original. Sem o map, o recorte cairia no
    // meio do prefixo e PERDERIA o termo; com o map, alinha e o pega inteiro.
    const grupo = 'a' + ACUTE + 'e' + ACUTE + 'i' + ACUTE + ' ' // 7 unidades -> 4 dobradas
    const prefix = grupo.repeat(30) // 210 orig -> 120 dobrado
    const s = snippetAround(prefix + 'ALVO_UNICO depois', ['alvo_unico'], 60)
    expect(s).toContain('ALVO_UNICO')
  })
})

describe('searchConversations', () => {
  it('acha por termo, exclui a conversa ativa, ranqueia por overlap', () => {
    const r = searchConversations(convs, 'backtest média', { excludeId: 'atual' })
    expect(r.length).toBeGreaterThan(0)
    expect(r.every(m => m.convId !== 'atual')).toBe(true)
    // a mensagem com 2 termos ("backtest" não está na do assistente; "média" sim)
    expect(r[0].convId).toBe('c1')
  })

  it('sem termos / sem conversas → vazio', () => {
    expect(searchConversations(convs, '', {})).toEqual([])
    expect(searchConversations(undefined, 'x', {})).toEqual([])
    expect(searchConversations(convs, 'inexistentexyz', {})).toEqual([])
  })

  it('respeita o teto max', () => {
    expect(searchConversations(convs, 'backtest deploy media movel erro', { max: 1 }).length).toBe(1)
  })
})

describe('formatConversationMatches', () => {
  it('agrupa por conversa com idade relativa', () => {
    const r = searchConversations(convs, 'backtest', { excludeId: 'atual' })
    const out = formatConversationMatches(r, 'backtest', NOW)
    expect(out).toContain('Backtest MT5')
    expect(out).toContain('há 2d')
    expect(out.toLowerCase()).toContain('conversas anteriores')
  })
  it('vazio → mensagem honesta', () => {
    expect(formatConversationMatches([], 'xyz', NOW).toLowerCase()).toContain('nada encontrado')
  })
})
