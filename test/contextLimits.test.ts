// ─── Janela de contexto por modelo (v2.203.0) ───────────────────────
//
// Um modelo AUSENTE da tabela cai no default 8192. Isso não é só uma
// imprecisão: `computeMessageBudget` usa esse número, então num modelo de
// janela 262k o orçamento saía 32× menor e a história era podada quase inteira
// todo turno — o modelo "esquecia" o que tinha acabado de ler. Mesma classe do
// bug que já derrubou o GLM (ver comentário em contextEngine.ts).

import { describe, it, expect } from 'vitest'
import { getModelContextLimitInfo, effectiveContextLimit, computeMessageBudget } from '../src/services/contextEngine'

describe('modelos que o app SUGERE precisam estar na tabela', () => {
  // Cada um destes aparece em config/providers.ts ou constants/modelSuggestions.ts
  const sugeridos: Array<[string, number]> = [
    ['sensenova-6.8-flash-lite', 262_144],
    ['deepseek-v4-flash', 262_144],
    ['deepseek-ai/DeepSeek-V3', 128_000],
    ['meta-llama/llama-3.3-70b-instruct', 128_000],
    ['zai-org/GLM-5.1-FP8', 200_000],
    ['gpt-4o', 128_000],
    ['gemini-2.0-flash', 1_000_000],
  ]

  it('nenhum cai no default de 8192', () => {
    for (const [m, esperado] of sugeridos) {
      const info = getModelContextLimitInfo(m)
      expect(info.known, `${m} não reconhecido`).toBe(true)
      expect(info.limit, m).toBe(esperado)
    }
  })

  it('variante nova do SenseNova cai no genérico, não no default', () => {
    expect(getModelContextLimitInfo('sensenova-9-turbo').limit).toBe(262_144)
  })

  it('ids hifenizados (OpenRouter) resolvem como os do Ollama', () => {
    // 'llama3.3' (estilo Ollama) não casava 'llama-3.3' (estilo OpenRouter).
    expect(getModelContextLimitInfo('meta-llama/llama-3.1-405b-instruct').limit).toBe(128_000)
    expect(getModelContextLimitInfo('llama3.1').limit).toBe(128_000)
  })

  it('o específico ainda vence o genérico', () => {
    expect(getModelContextLimitInfo('llama3').limit).toBe(8_192)      // não vira 128k
    expect(getModelContextLimitInfo('glm-4.5').limit).toBe(128_000)   // não vira 200k
  })
})

describe('o limite chega de fato ao orçamento do turno', () => {
  it('SenseNova rende um orçamento muito maior que o default antigo', () => {
    const overhead = { systemTokens: 2000, toolTokens: 3000, responseReserve: 2048 }
    const agora = computeMessageBudget(effectiveContextLimit('sensenova', 'sensenova-6.8-flash-lite'), overhead)
    const antes = computeMessageBudget(8_192, overhead)
    // 888 tokens de história num modelo de janela 262k — na prática o turno
    // anterior inteiro era descartado a cada mensagem.
    expect(antes).toBeLessThan(1_500)
    expect(agora).toBeGreaterThan(200_000)
    expect(agora / Math.max(1, antes)).toBeGreaterThan(200)
  })

  it('Ollama continua respeitando o num_ctx do usuário', () => {
    expect(effectiveContextLimit('ollama', 'qualquer', 16_384)).toBe(16_384)
    expect(effectiveContextLimit('ollama', 'qualquer', 0)).toBe(8_192)
  })
})
