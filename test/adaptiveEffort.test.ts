import { describe, it, expect } from 'vitest'
import { resolveAdaptiveEffort, scoreEffort, EFFORT_THRESHOLDS } from '../src/utils/adaptiveEffort'

const ORDER = ['off', 'low', 'medium', 'high']
const idx = (e: string) => ORDER.indexOf(e)

describe('resolveAdaptiveEffort', () => {
  it('saudação/trivial → off (mais rápido)', () => {
    expect(resolveAdaptiveEffort({ text: 'oi' })).toBe('off')
    expect(resolveAdaptiveEffort({ text: 'obrigado!' })).toBe('off')
    expect(resolveAdaptiveEffort({ text: 'hello' })).toBe('off')
  })

  it('pergunta factual curta → baixo esforço (off/low)', () => {
    expect(idx(resolveAdaptiveEffort({ text: 'o que é MCP?' }))).toBeLessThanOrEqual(idx('low'))
  })

  it('bloco de código / stack trace → esforço médio+', () => {
    const code = 'Corrija este bug:\n```js\nfunction f(){ return x.map(y=>y.z) }\n```\nDá TypeError: cannot read'
    expect(idx(resolveAdaptiveEffort({ text: code }))).toBeGreaterThanOrEqual(idx('medium'))
  })

  it('pedido longo de refator/análise → high', () => {
    const big = 'Refatore o módulo de autenticação inteiro: analise os trade-offs, otimize a performance, ' +
      'projete uma nova arquitetura e prove que a migração é segura. '.repeat(6)
    expect(resolveAdaptiveEffort({ text: big })).toBe('high')
  })

  it('modo agente nunca cai para off (piso = low)', () => {
    expect(idx(resolveAdaptiveEffort({ text: 'oi', isAgentMode: true }))).toBeGreaterThanOrEqual(idx('low'))
  })

  it('é determinístico (mesma entrada → mesma saída)', () => {
    const t = 'Implemente o cache e depure o vazamento de memória'
    expect(resolveAdaptiveEffort({ text: t })).toBe(resolveAdaptiveEffort({ text: t }))
  })

  it('lida com vazio', () => {
    expect(resolveAdaptiveEffort({ text: '' })).toBe('off')
  })
})

describe('scoreEffort', () => {
  it('agente adiciona piso de pontos; código pontua forte', () => {
    expect(scoreEffort('x', true)).toBeGreaterThan(scoreEffort('x', false))
    expect(scoreEffort('```\ncode\n```', false)).toBeGreaterThanOrEqual(EFFORT_THRESHOLDS.low)
  })
})
