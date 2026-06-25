import { describe, it, expect } from 'vitest'
import { verificationPrompt } from '../src/utils/verification'

describe('verificationPrompt', () => {
  it('cita a resposta e pede os passos do CoVe (PT)', () => {
    const p = verificationPrompt('pt', 'A Lua tem 12 km de diâmetro.')
    expect(p).toContain('A Lua tem 12 km de diâmetro.')
    expect(p).toMatch(/Chain-of-Verification/i)
    expect(p).toMatch(/perguntas? de verificação|pergunta de verificação/i)
    expect(p).toMatch(/Confirmado|Correções/)
  })

  it('versão EN menciona verificação e veredito', () => {
    const p = verificationPrompt('en', 'The Moon is 12km wide.')
    expect(p).toContain('The Moon is 12km wide.')
    expect(p).toMatch(/verification question/i)
    expect(p).toMatch(/Confirmed|Corrections/)
  })

  it('trunca respostas muito longas (não estoura o contexto)', () => {
    const huge = 'x'.repeat(10000)
    const p = verificationPrompt('en', huge)
    // a cópia da resposta é capada em 4000 chars (corre de 4000 x's existe, 4001 não)
    expect(p.includes('x'.repeat(4000))).toBe(true)
    expect(p.includes('x'.repeat(4001))).toBe(false)
  })
})
