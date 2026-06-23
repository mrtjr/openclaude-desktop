// ─── ContextEngine tests ──────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  createContextEngine,
  getModelContextLimit,
  effectiveContextLimit,
  DEFAULT_OLLAMA_NUM_CTX,
  computeMessageBudget,
  BUDGET_SAFETY_SLACK,
  MODEL_CONTEXT_LIMITS,
} from '../src/services/contextEngine'
import type { Message } from '../src/types'

function msg(content: string, role: 'user' | 'assistant' = 'user'): Message {
  return { id: String(Math.random()), role, content, timestamp: new Date() } as Message
}

describe('createContextEngine', () => {
  const engine = createContextEngine()

  it('returns empty array for empty input', () => {
    expect(engine.assemble([], 1000)).toEqual([])
  })

  it('keeps all messages when they fit the budget', () => {
    const msgs = [msg('hi'), msg('there'), msg('friend')]
    const out = engine.assemble(msgs, 10_000)
    expect(out).toHaveLength(3)
  })

  it('walks back from newest when budget is tight', () => {
    // 10 messages of ~25 tokens each (100 chars ÷ 4 + 4 overhead)
    const msgs = Array.from({ length: 10 }, (_, i) => msg('x'.repeat(100) + i))
    const out = engine.assemble(msgs, 80) // ~3 messages worth
    expect(out.length).toBeLessThan(10)
    expect(out.length).toBeGreaterThan(0)
    // Most recent message must be included
    expect(out[out.length - 1]).toBe(msgs[9])
  })

  it('always keeps at least one message even with a tiny budget', () => {
    const msgs = [msg('x'.repeat(10_000))]
    const out = engine.assemble(msgs, 10)
    expect(out).toHaveLength(1) // at least the newest
  })

  it('getTokenCount sums across messages', () => {
    const a = engine.getTokenCount([msg('hello')])
    const b = engine.getTokenCount([msg('hello'), msg('world')])
    expect(b).toBeGreaterThan(a)
  })

  it('countTokens handles empty string', () => {
    expect(engine.countTokens('')).toBe(0)
  })

  it('countTokens treats CJK chars as denser than Latin', () => {
    const latin = engine.countTokens('a'.repeat(30))
    const cjk = engine.countTokens('文'.repeat(30))
    expect(cjk).toBeGreaterThan(latin)
  })
})

describe('getModelContextLimit', () => {
  it('returns exact match for known models', () => {
    expect(getModelContextLimit('gpt-4o')).toBe(128_000)
    expect(getModelContextLimit('claude-sonnet-4-20250514')).toBe(200_000)
  })

  it('falls back to partial match for versioned model ids', () => {
    expect(getModelContextLimit('gpt-4o-2024-08-06')).toBe(128_000)
  })

  it('gives the 2026 1M-context Claude models their full window', () => {
    expect(getModelContextLimit('claude-opus-4-8')).toBe(1_000_000)
    expect(getModelContextLimit('claude-sonnet-4-6')).toBe(1_000_000)
    expect(getModelContextLimit('claude-haiku-4-5')).toBe(200_000)
  })

  it('returns safe default for unknown models', () => {
    expect(getModelContextLimit('some-random-local-model')).toBe(8_192)
  })

  it('llama3.x resolve a janela grande, não o 8k do genérico "llama3" (regressão de ordem)', () => {
    // 'llama3' (8k) é PREFIXO de 'llama3.1/3.2/3.3'; como o match parcial pega o
    // primeiro, a ordem genérico-antes-de-específico fazia "llama3.1" cair em 8k.
    expect(getModelContextLimit('llama3.1')).toBe(128_000)
    expect(getModelContextLimit('llama3.2')).toBe(128_000)
    expect(getModelContextLimit('llama3.3')).toBe(128_000)
    // O genérico exato continua 8k.
    expect(getModelContextLimit('llama3')).toBe(8_192)
  })

  it('detects Z.ai/GLM models served via Modal/OpenRouter (regression: the timeout bug)', () => {
    // The exact id from the Modal deployment that fell through to 8192 →
    // spurious auto tool-deferral → extra `tool_search` round-trip → timeout.
    expect(getModelContextLimit('zai-org/GLM-5.1-FP8')).toBe(200_000)
    expect(getModelContextLimit('z-ai/glm-5.1')).toBe(200_000)
    expect(getModelContextLimit('glm-4.6')).toBe(200_000)
    expect(getModelContextLimit('glm-4.5-air')).toBe(128_000)
    // Generic GLM fallback — never the tiny 8192 default.
    expect(getModelContextLimit('some-glm-variant')).toBeGreaterThanOrEqual(128_000)
  })

  it('keeps any GLM window above the auto-deferral threshold (no spurious tool_search)', () => {
    // 24 built-in tools ≈ 2.2k tokens; auto-deferral fires at ≥15% of ctx.
    // Any GLM window (≥128k) keeps that ratio ~1.7%, well under the threshold —
    // so the model never has to make the extra slow tool_search round-trip.
    const glmCtx = getModelContextLimit('zai-org/GLM-5.1-FP8')
    expect(2200 / glmCtx).toBeLessThan(0.15)
  })

  it('covers all documented families', () => {
    // Guard rails: make sure we don't silently lose a model family
    expect(Object.keys(MODEL_CONTEXT_LIMITS).length).toBeGreaterThan(15)
  })
})

describe('effectiveContextLimit — janela REAL por backend (v2.24.0)', () => {
  it('Ollama usa o num_ctx configurado, NÃO a janela teórica do modelo', () => {
    // qwen35 teórico = 128k, mas local num GPU de 12GB é inviável.
    expect(getModelContextLimit('huihui_ai/qwen3.5-abliterated')).toBe(128_000)
    expect(effectiveContextLimit('ollama', 'huihui_ai/qwen3.5-abliterated', 16384)).toBe(16384)
  })

  it('Ollama cai no default seguro quando num_ctx ausente/inválido', () => {
    expect(effectiveContextLimit('ollama', 'qwen3', undefined)).toBe(DEFAULT_OLLAMA_NUM_CTX)
    expect(effectiveContextLimit('ollama', 'qwen3', 0)).toBe(DEFAULT_OLLAMA_NUM_CTX)
    expect(effectiveContextLimit('ollama', 'qwen3', -5)).toBe(DEFAULT_OLLAMA_NUM_CTX)
    expect(effectiveContextLimit('ollama', 'qwen3', NaN)).toBe(DEFAULT_OLLAMA_NUM_CTX)
  })

  it('providers de nuvem ignoram num_ctx e usam a janela do modelo', () => {
    expect(effectiveContextLimit('modal', 'zai-org/GLM-5.1-FP8', 8192)).toBe(200_000)
    expect(effectiveContextLimit('anthropic', 'claude-opus-4-8', 8192)).toBe(1_000_000)
    expect(effectiveContextLimit('openai', 'gpt-4o', 8192)).toBe(128_000)
  })
})

describe('computeMessageBudget', () => {
  it('subtracts real overhead + safety slack from the limit', () => {
    const b = computeMessageBudget(128_000, {
      systemTokens: 1000, toolTokens: 2000, memoryTokens: 500, responseReserve: 4000,
    })
    expect(b).toBe(128_000 - 1000 - 2000 - 500 - 4000 - BUDGET_SAFETY_SLACK)
  })

  it('leaves almost the whole window on big models (no blind 40% reserve)', () => {
    const b = computeMessageBudget(200_000, { systemTokens: 1200, toolTokens: 2200, responseReserve: 4096 })
    expect(b).toBeGreaterThan(190_000)
    // Strictly better than the old `limit * 0.60` cap (120k).
    expect(b).toBeGreaterThan(Math.floor(200_000 * 0.60))
  })

  it('clamps to 0 (never negative) when overhead alone exceeds the window', () => {
    const b = computeMessageBudget(8_192, { systemTokens: 6000, toolTokens: 3000, responseReserve: 2048 })
    expect(b).toBe(0) // assemble() still keeps the newest message
  })

  it('never exceeds the limit and tolerates missing fields', () => {
    const b = computeMessageBudget(16_000, {})
    expect(b).toBe(16_000 - BUDGET_SAFETY_SLACK)
    expect(b).toBeLessThanOrEqual(16_000)
  })

  it('is conservative on small models — subtracts overhead the old 0.60 ignored', () => {
    const precise = computeMessageBudget(8_192, {
      systemTokens: 1800, toolTokens: 300, memoryTokens: 200, responseReserve: 2048,
    })
    // Smaller than the blind 60% because it actually reserves the reply +
    // prompt overhead the heuristic left unaccounted → no more overflow.
    expect(precise).toBeLessThan(Math.floor(8_192 * 0.60))
    expect(precise).toBeGreaterThan(0)
  })

  it('reserva o bufferReserve (autocompact) deixando headroom real (v2.49.0)', () => {
    const sem = computeMessageBudget(200_000, { systemTokens: 1000, responseReserve: 2048 })
    const com = computeMessageBudget(200_000, { systemTokens: 1000, responseReserve: 2048, bufferReserve: 30_000 })
    expect(sem - com).toBe(30_000)
    // com a reserva de 15%, a história fica bem abaixo do limite (não enche 100%).
    expect(com).toBeLessThanOrEqual(Math.floor(200_000 * 0.85))
  })
})

import { getModelContextLimitInfo, isKnownModelLimit } from '../src/services/contextEngine'
describe('getModelContextLimitInfo / isKnownModelLimit (v2.127.0)', () => {
  it('reconhece modelo da tabela (known:true)', () => {
    const r = getModelContextLimitInfo('claude-opus-4-8')
    expect(r.known).toBe(true)
    expect(r.limit).toBeGreaterThan(8192)
  })
  it('modelo desconhecido cai no default 8192 com known:false', () => {
    expect(getModelContextLimitInfo('modelo-inexistente-xyz')).toEqual({ limit: 8192, known: false })
  })
  it('Ollama é sempre "conhecido" (num_ctx do usuário)', () => {
    expect(isKnownModelLimit('ollama', 'qualquer-coisa')).toBe(true)
    expect(isKnownModelLimit('modal', 'modelo-inexistente-xyz')).toBe(false)
  })
})
