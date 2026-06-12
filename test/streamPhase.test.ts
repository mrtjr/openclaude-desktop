import { describe, it, expect } from 'vitest'
import { nextStreamPhase, formatCharCount, streamPhaseLabel, type StreamPhase } from '../src/utils/streamPhase'

describe('nextStreamPhase — raciocínio (reasoning_content / reasoning)', () => {
  it('entra na fase reasoning e acumula chars entre deltas', () => {
    const p1 = nextStreamPhase(null, { reasoning_content: 'hmm, ' })
    expect(p1).toEqual({ kind: 'reasoning', chars: 5 })
    const p2 = nextStreamPhase(p1 as StreamPhase, { reasoning_content: 'vejamos' })
    expect(p2).toEqual({ kind: 'reasoning', chars: 12 })
  })

  it('aceita o campo `reasoning` do OpenRouter', () => {
    expect(nextStreamPhase(null, { reasoning: 'abc' })).toEqual({ kind: 'reasoning', chars: 3 })
  })

  it('texto visível encerra a fase (null) e só notifica uma vez', () => {
    const p = nextStreamPhase(null, { reasoning_content: 'x'.repeat(50) })
    expect(nextStreamPhase(p as StreamPhase, { content: 'Olá' })).toBeNull()
    // já fora de fase: mais content não gera atualização (throttle barato)
    expect(nextStreamPhase(null, { content: 'mundo' })).toBeUndefined()
  })
})

describe('nextStreamPhase — montagem de tool call', () => {
  it('captura nome e acumula os bytes de argumentos', () => {
    const p1 = nextStreamPhase(null, { tool_calls: [{ function: { name: 'write_file', arguments: '{"pa' } }] })
    expect(p1).toEqual({ kind: 'tool', tool: 'write_file', chars: 4 })
    const p2 = nextStreamPhase(p1 as StreamPhase, { tool_calls: [{ function: { arguments: 'th": "a.ts"}' } }] })
    expect(p2).toEqual({ kind: 'tool', tool: 'write_file', chars: 16 })
  })

  it('reasoning → tool: troca de fase zera o contador (precedência da tool)', () => {
    const reasoning = nextStreamPhase(null, { reasoning_content: 'x'.repeat(900) })
    const p = nextStreamPhase(reasoning as StreamPhase, { tool_calls: [{ function: { name: 'execute_command', arguments: '{' } }] })
    expect(p).toEqual({ kind: 'tool', tool: 'execute_command', chars: 1 })
  })

  it('delta com tool_calls E reasoning prioriza a tool', () => {
    const p = nextStreamPhase(null, { reasoning_content: 'pensa', tool_calls: [{ function: { name: 'web_search', arguments: 'abc' } }] })
    expect(p?.kind).toBe('tool')
  })
})

describe('nextStreamPhase — sem mudança', () => {
  it('delta vazio/irrelevante devolve undefined (caller não re-renderiza)', () => {
    expect(nextStreamPhase(null, {})).toBeUndefined()
    expect(nextStreamPhase(null, { role: 'assistant' })).toBeUndefined()
    expect(nextStreamPhase(null, null)).toBeUndefined()
    expect(nextStreamPhase(null, { content: '' })).toBeUndefined()
  })
})

describe('formatCharCount / streamPhaseLabel', () => {
  it('formata contagens pt-BR compactas', () => {
    expect(formatCharCount(850)).toBe('850')
    expect(formatCharCount(3421)).toBe('3,4k')
    expect(formatCharCount(12100)).toBe('12,1k')
  })

  it('gera rótulos prontos para a UI', () => {
    expect(streamPhaseLabel({ kind: 'reasoning', chars: 3421 })).toBe('raciocinando… 3,4k chars')
    expect(streamPhaseLabel({ kind: 'tool', tool: 'write_file', chars: 12100 })).toBe('montando write_file… 12,1k chars')
    expect(streamPhaseLabel({ kind: 'tool', chars: 10 })).toBe('montando tool call… 10 chars')
  })
})
