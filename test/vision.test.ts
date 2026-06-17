import { describe, it, expect } from 'vitest'
import {
  resolveVisionTarget, formatVisionResult, DEFAULT_VISION_OLLAMA_MODEL,
} from '../src/utils/vision'

describe('resolveVisionTarget', () => {
  it('Ollama → modelo de visão (visionModel ou llava), sem chave', () => {
    expect(resolveVisionTarget({ provider: 'ollama' })).toEqual({ provider: 'ollama', model: 'llava', apiKey: '' })
    expect(resolveVisionTarget({ provider: 'ollama', visionModel: 'llama3.2-vision' }))
      .toEqual({ provider: 'ollama', model: 'llama3.2-vision', apiKey: '' })
  })

  it('nuvem → modelo + chave do provider configurado', () => {
    const t = resolveVisionTarget({ provider: 'openai', openaiModel: 'gpt-4o', openaiApiKey: 'k' })
    expect(t).toEqual({ provider: 'openai', model: 'gpt-4o', apiKey: 'k' })
    const g = resolveVisionTarget({ provider: 'gemini', geminiModel: 'gemini-2.0-flash', geminiApiKey: 'gk' })
    expect(g).toEqual({ provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'gk' })
  })

  it('provider sem suporte a visão (custom) → null', () => {
    expect(resolveVisionTarget({ provider: 'custom' })).toBeNull()
  })

  it('default = ollama/llava quando settings ausente', () => {
    expect(resolveVisionTarget(undefined)).toEqual({ provider: 'ollama', model: DEFAULT_VISION_OLLAMA_MODEL, apiKey: '' })
  })
})

describe('formatVisionResult', () => {
  it('sucesso → análise com rótulo', () => {
    const out = formatVisionResult({ response: 'Vejo um gráfico de candles.' }, 'a tela')
    expect(out).toContain('Análise de a tela')
    expect(out).toContain('candles')
  })
  it('erro → mensagem acionável', () => {
    expect(formatVisionResult({ error: 'modelo offline' }, 'a imagem')).toContain('modelo offline')
    expect(formatVisionResult(null, 'a tela').toLowerCase()).toContain('não consegui analisar')
  })
  it('resposta vazia → aviso, não string vazia', () => {
    expect(formatVisionResult({ response: '   ' }, 'a tela')).toContain('não retornou descrição')
  })
})
