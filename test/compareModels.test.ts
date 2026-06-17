import { describe, it, expect } from 'vitest'
import {
  parseCompareSpecs, providerApiKey, extractChatText, formatComparison, MAX_COMPARE_MODELS,
} from '../src/utils/compareModels'

describe('parseCompareSpecs', () => {
  it('lista de strings → usa o provider atual', () => {
    expect(parseCompareSpecs(['gpt-4o', 'gpt-4o-mini'], 'openai')).toEqual([
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'openai', model: 'gpt-4o-mini' },
    ])
  })

  it('objetos {model, provider} → cross-provider', () => {
    const specs = parseCompareSpecs([
      { model: 'gpt-4o', provider: 'openai' },
      { model: 'claude-sonnet-4-6', provider: 'anthropic' },
    ], 'ollama')
    expect(specs).toEqual([
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ])
  })

  it('dedup por provider:model e corta no teto', () => {
    const many = Array.from({ length: 10 }, (_, i) => `m${i}`)
    expect(parseCompareSpecs(many, 'ollama').length).toBe(MAX_COMPARE_MODELS)
    expect(parseCompareSpecs(['a', 'a', 'b'], 'ollama')).toEqual([
      { provider: 'ollama', model: 'a' }, { provider: 'ollama', model: 'b' },
    ])
  })

  it('descarta entradas inválidas e não-array', () => {
    expect(parseCompareSpecs('nope', 'ollama')).toEqual([])
    expect(parseCompareSpecs([{ provider: 'openai' }, '', '  '], 'ollama')).toEqual([])
  })
})

describe('providerApiKey', () => {
  it('pega a chave certa por provider; ollama é vazio', () => {
    const s = { openaiApiKey: 'oai', anthropicApiKey: 'ant' }
    expect(providerApiKey(s, 'openai')).toBe('oai')
    expect(providerApiKey(s, 'anthropic')).toBe('ant')
    expect(providerApiKey(s, 'ollama')).toBe('')
    expect(providerApiKey(undefined, 'openai')).toBe('')
  })
})

describe('extractChatText', () => {
  it('OpenAI shape', () => {
    expect(extractChatText({ choices: [{ message: { content: 'oi' } }] })).toBe('oi')
  })
  it('Anthropic shape', () => {
    expect(extractChatText({ content: [{ text: 'ola' }] })).toBe('ola')
  })
  it('Gemini shape', () => {
    expect(extractChatText({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })).toBe('hi')
  })
  it('vazio/desconhecido → string vazia', () => {
    expect(extractChatText({})).toBe('')
    expect(extractChatText(null)).toBe('')
  })
})

describe('formatComparison', () => {
  const results = [
    { provider: 'openai', model: 'gpt-4o', text: 'Resposta A', ms: 1200 },
    { provider: 'ollama', model: 'llama3.2', text: 'Resposta B', ms: 800, error: null },
  ]
  it('rotula cada modelo, tempo e pede síntese', () => {
    const out = formatComparison('qual a capital?', results)
    expect(out).toContain('gpt-4o (openai)')
    expect(out).toContain('llama3.2 (ollama)')
    expect(out).toContain('Resposta A')
    expect(out).toContain('1.2s')
    expect(out.toLowerCase()).toContain('sintetize')
  })
  it('mostra erro por modelo sem quebrar', () => {
    const out = formatComparison('q', [{ provider: 'modal', model: 'x', text: '', ms: 500, error: 'timeout' }])
    expect(out).toContain('[erro: timeout]')
  })
  it('lista vazia → mensagem clara', () => {
    expect(formatComparison('q', [])).toContain('nenhum modelo válido')
  })
})
