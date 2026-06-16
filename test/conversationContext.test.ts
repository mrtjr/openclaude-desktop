import { describe, it, expect } from 'vitest'
import { renderConversationTranscript, buildImportedContextBlock, IMPORT_VERBATIM_CHAR_BUDGET } from '../src/utils/conversationContext'
import type { Conversation } from '../src/types'

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1', title: 'Pentest otserv', messages: [], createdAt: new Date(), ...over,
} as Conversation)

describe('renderConversationTranscript', () => {
  it('renderiza usuário, assistente e resultado de ferramenta', () => {
    const c = conv({ messages: [
      { id: 'm1', role: 'user', content: 'verifique o site', timestamp: new Date() } as any,
      { id: 'm2', role: 'assistant', content: 'achei um bug de IDOR', timestamp: new Date(),
        toolCalls: [{ id: 't1', name: 'fetch_url', arguments: { url: 'x' } }],
        toolResults: [{ toolCallId: 't1', name: 'fetch_url', result: 'status 200 ...' }] } as any,
    ] })
    const t = renderConversationTranscript(c)
    expect(t).toContain('# Pentest otserv')
    expect(t).toContain('## Usuário')
    expect(t).toContain('verifique o site')
    expect(t).toContain('achei um bug de IDOR')
    expect(t).toContain('Ferramenta: fetch_url')
    expect(t).toContain('status 200')
  })
  it('trunca resultados longos de ferramenta', () => {
    const big = 'x'.repeat(5000)
    const c = conv({ messages: [
      { id: 'm', role: 'assistant', content: '', timestamp: new Date(),
        toolCalls: [{ id: 't', name: 'execute_command', arguments: {} }],
        toolResults: [{ toolCallId: 't', name: 'execute_command', result: big }] } as any,
    ] })
    const t = renderConversationTranscript(c, { maxResultChars: 100 })
    expect(t).toContain('…[truncado]')
    expect(t.length).toBeLessThan(big.length)
  })
  it('inclui contexto anterior se houver e lida com vazio', () => {
    expect(renderConversationTranscript(conv({ contextSummary: 'resumo X' }))).toContain('resumo X')
    expect(renderConversationTranscript(conv())).toContain('# Pentest otserv')
  })
})

describe('buildImportedContextBlock', () => {
  it('cabeçalho instrui continuar e reusar', () => {
    const b = buildImportedContextBlock('Conversa A', 'corpo aqui')
    expect(b).toContain('CONTEXTO IMPORTADO da conversa "Conversa A"')
    expect(b).toMatch(/REUSE|reuse/i)
    expect(b).toContain('corpo aqui')
  })
  it('orçamento exposto', () => {
    expect(IMPORT_VERBATIM_CHAR_BUDGET).toBeGreaterThan(1000)
  })
})
