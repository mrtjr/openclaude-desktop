import { describe, it, expect } from 'vitest'
import { initStallState, decideStallRetry, STALL_LIMITS } from '../src/utils/stallRecovery'

describe('decideStallRetry — orçamento por-passo + teto por-turno', () => {
  it('permite 1 retry no mesmo passo, recusa o 2º', () => {
    let s = initStallState()
    const a = decideStallRetry(s, 3); s = a.state
    expect(a.retry).toBe(true)
    const b = decideStallRetry(s, 3); s = b.state
    expect(b.retry).toBe(false) // mesmo passo, orçamento por-passo esgotado
  })

  it('zera o contador por-passo quando o passo avança (run longo sobrevive a stalls isolados)', () => {
    // stall no passo 1 (recupera), depois stall no passo 5
    let s = initStallState()
    let r = decideStallRetry(s, 1); s = r.state
    expect(r.retry).toBe(true)
    r = decideStallRetry(s, 5); s = r.state
    expect(r.retry).toBe(true) // passo diferente → novo orçamento por-passo
    expect(s.perTurn).toBe(2)
  })

  it('respeita o teto por-turno mesmo em passos diferentes', () => {
    let s = initStallState()
    // 3 passos distintos travando uma vez cada → 3 retries (teto = 3)
    for (const step of [1, 2, 3]) {
      const r = decideStallRetry(s, step); s = r.state
      expect(r.retry).toBe(true)
    }
    // 4º passo distinto → teto por-turno atingido, recusa
    const last = decideStallRetry(s, 4); s = last.state
    expect(last.retry).toBe(false)
    expect(s.perTurn).toBe(STALL_LIMITS.perTurn)
  })

  it('é determinístico/terminante: um stall que repete sempre no mesmo passo para após 1 retry', () => {
    let s = initStallState()
    let retries = 0
    for (let i = 0; i < 10; i++) {
      const r = decideStallRetry(s, 7); s = r.state
      if (r.retry) retries++
    }
    expect(retries).toBe(STALL_LIMITS.perStep) // exatamente 1, nunca loop infinito
  })

  it('limites customizados são respeitados', () => {
    let s = initStallState()
    const lim = { perStep: 2, perTurn: 5 }
    expect(decideStallRetry(s, 1, lim).retry).toBe(true)
    s = decideStallRetry(s, 1, lim).state
    expect(s.perStep).toBe(1)
  })
})
