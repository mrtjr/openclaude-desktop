import { describe, it, expect } from 'vitest'
import { reasoningRequestParams, ANTHROPIC_BUDGET } from '../electron/reasoning-control.js'

describe('reasoningRequestParams — default é no-op (seguro)', () => {
  it('default/ausente não envia nada para nenhum provider', () => {
    for (const p of ['modal', 'ollama', 'openai', 'anthropic', 'openrouter', 'custom']) {
      expect(reasoningRequestParams(p, 'm', 'default')).toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
      expect(reasoningRequestParams(p, 'm', undefined)).toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
    }
  })
})

describe('reasoningRequestParams — GLM/Modal (binário via chat_template_kwargs)', () => {
  it('off desliga o thinking; níveis ligam (profundidade não controlável)', () => {
    expect(reasoningRequestParams('modal', 'zai-org/GLM-5.1-FP8', 'off').extra)
      .toEqual({ chat_template_kwargs: { enable_thinking: false } })
    expect(reasoningRequestParams('modal', 'zai-org/GLM-5.1-FP8', 'high').extra)
      .toEqual({ chat_template_kwargs: { enable_thinking: true } })
    expect(reasoningRequestParams('modal', 'x', 'low').extra)
      .toEqual({ chat_template_kwargs: { enable_thinking: true } })
    expect(reasoningRequestParams('modal', 'x', 'off').dropTemperature).toBe(false)
  })
})

describe('reasoningRequestParams — Ollama (think binário)', () => {
  it('off → think:false; on → think:true', () => {
    expect(reasoningRequestParams('ollama', 'qwen3', 'off').extra).toEqual({ think: false })
    expect(reasoningRequestParams('ollama', 'qwen3', 'medium').extra).toEqual({ think: true })
  })
})

describe('reasoningRequestParams — OpenAI / OpenRouter / Custom (reasoning_effort)', () => {
  it('envia reasoning_effort nos níveis; off não envia', () => {
    expect(reasoningRequestParams('openai', 'o3', 'high').extra).toEqual({ reasoning_effort: 'high' })
    expect(reasoningRequestParams('openrouter', 'x', 'low').extra).toEqual({ reasoning_effort: 'low' })
    expect(reasoningRequestParams('custom', 'x', 'medium').extra).toEqual({ reasoning_effort: 'medium' })
    expect(reasoningRequestParams('openai', 'o3', 'off')).toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
  })
})

describe('reasoningRequestParams — Anthropic (thinking budget, sem temperature)', () => {
  it('liga thinking com budget por nível, remove temperature e exige max_tokens > budget', () => {
    const r = reasoningRequestParams('anthropic', 'claude-sonnet-4-6', 'high')
    expect(r.extra).toEqual({ thinking: { type: 'enabled', budget_tokens: ANTHROPIC_BUDGET.high } })
    expect(r.dropTemperature).toBe(true)
    expect(r.minMaxTokens).toBe(ANTHROPIC_BUDGET.high + 2048)
  })

  it('off não liga thinking (nada enviado, temperatura preservada)', () => {
    expect(reasoningRequestParams('anthropic', 'claude-sonnet-4-6', 'off'))
      .toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
  })

  it('nível inválido cai no budget médio', () => {
    const r = reasoningRequestParams('anthropic', 'm', 'weird')
    expect(r.extra.thinking.budget_tokens).toBe(ANTHROPIC_BUDGET.medium)
  })
})

describe('reasoningRequestParams — provider desconhecido', () => {
  it('é no-op', () => {
    expect(reasoningRequestParams('gemini', 'm', 'high')).toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
  })
})
