import { describe, it, expect } from 'vitest'
import { nextFallbackModel, isModelSwappableError } from '../src/utils/fallbackChain'

describe('nextFallbackModel', () => {
  it('devolve o primeiro fallback ainda não tentado, pulando o atual', () => {
    const tried = new Set<string>()
    expect(nextFallbackModel('a', ['b', 'c'], tried)).toBe('b')
  })
  it('pula o modelo atual mesmo se estiver na lista', () => {
    expect(nextFallbackModel('b', ['b', 'c'], new Set())).toBe('c')
  })
  it('pula os já tentados e esgota devolvendo null', () => {
    const tried = new Set(['b'])
    expect(nextFallbackModel('a', ['b', 'c'], tried)).toBe('c')
    tried.add('c')
    expect(nextFallbackModel('a', ['b', 'c'], tried)).toBeNull()
  })
  it('lista vazia/ausente → null', () => {
    expect(nextFallbackModel('a', [], new Set())).toBeNull()
    expect(nextFallbackModel('a', undefined, new Set())).toBeNull()
  })
  it('ignora entradas em branco', () => {
    expect(nextFallbackModel('a', ['', '  ', 'b'], new Set())).toBe('b')
  })
})

describe('isModelSwappableError', () => {
  it('trocar de modelo NÃO resolve contexto/stall/tools', () => {
    expect(isModelSwappableError('context')).toBe(false)
    expect(isModelSwappableError('stall')).toBe(false)
    expect(isModelSwappableError('tools')).toBe(false)
  })
  it('resolve overload/timeout/instabilidade/desconhecido', () => {
    expect(isModelSwappableError('overloaded')).toBe(true)
    expect(isModelSwappableError('timeout')).toBe(true)
    expect(isModelSwappableError('network')).toBe(true)
    expect(isModelSwappableError('unknown')).toBe(true)
    expect(isModelSwappableError(undefined)).toBe(true)
  })
})
