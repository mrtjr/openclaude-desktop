import { describe, it, expect } from 'vitest'
import {
  queryTerms, snippetAround, searchConversations, formatConversationMatches,
  type ConversationLike,
} from '../src/utils/searchConversations'

const NOW = new Date('2026-06-17T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).getTime()

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

describe('snippetAround', () => {
  it('recorta ao redor do termo com reticências', () => {
    const s = snippetAround('x'.repeat(200) + ' média móvel ' + 'y'.repeat(200), ['media'], 60)
    expect(s).toContain('média móvel')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
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
