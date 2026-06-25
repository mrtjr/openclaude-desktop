import { describe, it, expect } from 'vitest'
import { reasoningRequestParams, ANTHROPIC_BUDGET, anthropicModelInfo, anthropicAcceptsTemperature } from '../electron/reasoning-control.js'

describe('reasoningRequestParams — default é no-op (seguro)', () => {
  it('default/ausente não envia nada para nenhum provider', () => {
    for (const p of ['modal', 'ollama', 'openai', 'anthropic', 'openrouter', 'custom']) {
      expect(reasoningRequestParams(p, 'm', 'default')).toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
      expect(reasoningRequestParams(p, 'm', undefined)).toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
    }
  })
})

describe('reasoningRequestParams — fallback de "auto" (v2.50.0)', () => {
  it('"auto" que vaze até o backend é tratado como "medium" (não cai no default)', () => {
    // OpenAI: medium → reasoning_effort: 'medium'
    expect(reasoningRequestParams('openai', 'o3', 'auto').extra).toEqual({ reasoning_effort: 'medium' })
    // Anthropic: medium → budget de medium
    expect(reasoningRequestParams('anthropic', 'claude', 'auto').extra.thinking.budget_tokens).toBe(ANTHROPIC_BUDGET.medium)
    // GLM: liga o thinking (não é no-op de default)
    expect(reasoningRequestParams('modal', 'glm', 'auto').extra).toEqual({ chat_template_kwargs: { enable_thinking: true } })
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

  it('rebaixa xhigh/max para high (reasoning_effort só conhece low|medium|high) — v2.140.0', () => {
    expect(reasoningRequestParams('openai', 'o3', 'xhigh').extra).toEqual({ reasoning_effort: 'high' })
    expect(reasoningRequestParams('openrouter', 'x', 'max').extra).toEqual({ reasoning_effort: 'high' })
  })
})

describe('anthropicModelInfo — classificação de geração (v2.140.0)', () => {
  it('Opus 4.7/4.8 e Fable 5: effortGen E noSampling (rejeitam temperature)', () => {
    for (const m of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-fable-5', 'claude-mythos-5']) {
      expect(anthropicModelInfo(m)).toEqual({ effortGen: true, noSampling: true })
      expect(anthropicAcceptsTemperature(m)).toBe(false)
    }
  })
  it('Opus 4.5/4.6 e Sonnet 4.6: effortGen mas AINDA aceitam temperature', () => {
    for (const m of ['claude-opus-4-5', 'claude-opus-4-6', 'claude-sonnet-4-6']) {
      expect(anthropicModelInfo(m)).toEqual({ effortGen: true, noSampling: false })
      expect(anthropicAcceptsTemperature(m)).toBe(true)
    }
  })
  it('gerações antigas (Sonnet 4.5 / Opus 4.1 / 3.x / genérico): legado', () => {
    for (const m of ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-opus', 'claude']) {
      expect(anthropicModelInfo(m)).toEqual({ effortGen: false, noSampling: false })
      expect(anthropicAcceptsTemperature(m)).toBe(true)
    }
  })
})

describe('reasoningRequestParams — Anthropic moderna (adaptive + output_config.effort)', () => {
  it('Opus 4.8: adaptive thinking + effort, SEM budget_tokens, remove temperature', () => {
    const r = reasoningRequestParams('anthropic', 'claude-opus-4-8', 'high')
    expect(r.extra).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } })
    expect(r.extra.thinking.budget_tokens).toBeUndefined()
    expect(r.dropTemperature).toBe(true)
    expect(r.minMaxTokens).toBe(0)
  })

  it('passa xhigh/max adiante (níveis novos da Anthropic)', () => {
    expect(reasoningRequestParams('anthropic', 'claude-opus-4-8', 'xhigh').extra.output_config).toEqual({ effort: 'xhigh' })
    expect(reasoningRequestParams('anthropic', 'claude-opus-4-7', 'max').extra.output_config).toEqual({ effort: 'max' })
  })

  it('Sonnet 4.6 (effortGen, mas aceita temperature): effort + adaptive; drop só por thinking on', () => {
    const r = reasoningRequestParams('anthropic', 'claude-sonnet-4-6', 'medium')
    expect(r.extra).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } })
    expect(r.dropTemperature).toBe(true) // on → amostragem padrão
  })

  it('moderna + off: sem thinking; noSampling ainda força dropTemperature', () => {
    const r = reasoningRequestParams('anthropic', 'claude-opus-4-8', 'off')
    expect(r.extra).toEqual({})
    expect(r.dropTemperature).toBe(true) // 4.8 nunca aceita temperature
  })
})

describe('reasoningRequestParams — Anthropic legada (extended thinking budget)', () => {
  it('Sonnet 4.5: thinking budget por nível, remove temperature, max_tokens > budget', () => {
    const r = reasoningRequestParams('anthropic', 'claude-sonnet-4-5', 'high')
    expect(r.extra).toEqual({ thinking: { type: 'enabled', budget_tokens: ANTHROPIC_BUDGET.high } })
    expect(r.dropTemperature).toBe(true)
    expect(r.minMaxTokens).toBe(ANTHROPIC_BUDGET.high + 2048)
  })

  it('off legado não liga thinking (temperatura preservada)', () => {
    expect(reasoningRequestParams('anthropic', 'claude-sonnet-4-5', 'off'))
      .toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
  })

  it('nível inválido em modelo legado cai no budget médio', () => {
    const r = reasoningRequestParams('anthropic', 'claude-3-opus', 'weird')
    expect(r.extra.thinking.budget_tokens).toBe(ANTHROPIC_BUDGET.medium)
  })
})

describe('reasoningRequestParams — provider desconhecido', () => {
  it('é no-op', () => {
    expect(reasoningRequestParams('gemini', 'm', 'high')).toEqual({ extra: {}, dropTemperature: false, minMaxTokens: 0 })
  })
})
