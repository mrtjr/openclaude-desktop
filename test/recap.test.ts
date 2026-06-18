import { describe, it, expect } from 'vitest'
import { firstLine, buildRecap } from '../src/utils/recap'

describe('firstLine', () => {
  it('pega a 1ª linha não-vazia e tira markdown leve', () => {
    expect(firstLine('\n\n## Título\nresto')).toBe('Título')
    expect(firstLine('**negrito** ok')).toBe('negrito ok')
  })
  it('pula blocos de código', () => {
    expect(firstLine('```js\ncode\n```\nDepois do bloco')).toBe('Depois do bloco')
  })
  it('trunca com reticências', () => {
    expect(firstLine('x'.repeat(200), 10)).toBe('xxxxxxxxx…')
  })
})

describe('buildRecap', () => {
  it('usa a última mensagem do assistente', () => {
    const conv = { title: 'Bug do login', messages: [
      { role: 'user', content: 'arruma' },
      { role: 'assistant', content: 'Corrigi o handler de auth e adicionei um teste.' },
    ] }
    expect(buildRecap(conv, 'pt')).toBe('"Bug do login" — Corrigi o handler de auth e adicionei um teste.')
  })
  it('sem resposta do assistente → frase de "pronto"', () => {
    expect(buildRecap({ title: 'X', messages: [{ role: 'user', content: 'oi' }] }, 'en')).toBe('Reply ready in "X"')
  })
  it('título ausente cai no genérico', () => {
    expect(buildRecap({ messages: [] }, 'pt')).toContain('uma conversa')
  })
})
