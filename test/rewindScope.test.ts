// ─── Escopo do rewind (v2.209.0) ────────────────────────────────────
//
// Reverter tinha só um confirm() — duas saídas. São TRÊS: cancelar, desfazer
// só os arquivos, ou também rebobinar a conversa. O corte precisa cair no
// INÍCIO do turno: parar na resposta deixaria a pergunta do usuário órfã.

import { describe, it, expect } from 'vitest'
import { turnStartIndex, rewindMessageCount } from '../src/utils/conversationEdit'
import type { Message } from '../src/types'

const m = (id: string, role: Message['role']): Message => ({ id, role, content: id } as Message)

// u1 → a1 | u2 → a2(tool) → a3 | u3 → a4
const conversa: Message[] = [
  m('u1', 'user'), m('a1', 'assistant'),
  m('u2', 'user'), m('a2', 'assistant'), m('a3', 'assistant'),
  m('u3', 'user'), m('a4', 'assistant'),
]

describe('turnStartIndex — o corte cai na pergunta, não na resposta', () => {
  it('a resposta do último turno volta até a pergunta dele', () => {
    expect(turnStartIndex(conversa, 'a4')).toBe(5) // índice de u3
  })

  it('um turno com VÁRIAS mensagens do assistente volta à mesma pergunta', () => {
    // Turnos de agente rendem várias bolhas; todas devem apontar para u2.
    expect(turnStartIndex(conversa, 'a3')).toBe(2)
    expect(turnStartIndex(conversa, 'a2')).toBe(2)
  })

  it('o primeiro turno volta ao início da conversa', () => {
    expect(turnStartIndex(conversa, 'a1')).toBe(0)
  })

  it('mensagem inexistente devolve -1 em vez de cortar do zero', () => {
    // Um 0 aqui apagaria a conversa inteira em silêncio.
    expect(turnStartIndex(conversa, 'nao-existe')).toBe(-1)
    expect(turnStartIndex([], 'a1')).toBe(-1)
  })

  it('tolera entrada inválida', () => {
    expect(turnStartIndex(null as any, 'x')).toBe(-1)
    expect(turnStartIndex(undefined as any, 'x')).toBe(-1)
  })
})

describe('rewindMessageCount — o número que o diálogo mostra', () => {
  it('conta o turno inteiro, ida e volta', () => {
    expect(rewindMessageCount(conversa, 'a4')).toBe(2) // u3 + a4
    expect(rewindMessageCount(conversa, 'a3')).toBe(5) // u2..a4
    expect(rewindMessageCount(conversa, 'a1')).toBe(7) // tudo
  })

  it('mensagem inexistente conta zero — o diálogo desabilita a opção', () => {
    expect(rewindMessageCount(conversa, 'nao-existe')).toBe(0)
  })
})

describe('o corte é consistente com a contagem', () => {
  it('slice(0, start) remove exatamente o que foi anunciado', () => {
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      const start = turnStartIndex(conversa, id)
      const restante = conversa.slice(0, start)
      expect(conversa.length - restante.length, id).toBe(rewindMessageCount(conversa, id))
    }
  })

  it('o que sobra nunca termina numa pergunta sem resposta', () => {
    for (const id of ['a2', 'a3', 'a4']) {
      const restante = conversa.slice(0, turnStartIndex(conversa, id))
      if (restante.length) expect(restante[restante.length - 1].role, id).not.toBe('user')
    }
  })
})
