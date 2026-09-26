// ─── Janela de contexto aprendida do provider (v2.207.0) ────────────
//
// A tabela fixa `MODEL_CONTEXT_LIMITS` é mantida à mão, e todo modelo ausente
// dela cai em 8192 — foi assim que o sensenova-6.8-flash-lite (262k) teve o
// orçamento calculado contra 1/32 do tamanho real. O `/v1/models` do provider
// já informa a janela verdadeira; agora ela é guardada e VENCE a tabela.

import { describe, it, expect } from 'vitest'
import {
  getModelContextLimitInfo, getModelContextLimit,
  effectiveContextLimit, isKnownModelLimit, computeMessageBudget,
} from '../src/services/contextEngine'
import { readFileSync } from 'fs'

describe('o aprendido vence a tabela fixa', () => {
  it('um modelo FORA da tabela deixa de cair no default 8192', () => {
    const semAprender = getModelContextLimitInfo('modelo-novo-do-provider')
    expect(semAprender).toEqual({ limit: 8192, known: false })

    const comAprender = getModelContextLimitInfo('modelo-novo-do-provider', { 'modelo-novo-do-provider': 262_144 })
    expect(comAprender).toEqual({ limit: 262_144, known: true })
  })

  it('corrige um valor DESATUALIZADO da tabela', () => {
    // A conta do usuário é a verdade; a tabela é palpite mantido à mão.
    expect(getModelContextLimit('gpt-4o')).toBe(128_000)
    expect(getModelContextLimit('gpt-4o', { 'gpt-4o': 400_000 })).toBe(400_000)
  })

  it('só afeta o modelo aprendido, não os vizinhos', () => {
    const learned = { 'gpt-4o': 400_000 }
    expect(getModelContextLimit('gpt-4o-mini', learned)).toBe(128_000)
    expect(getModelContextLimit('claude-sonnet-4-6', learned)).toBe(1_000_000)
  })
})

describe('valores inválidos não podem envenenar o orçamento', () => {
  it('zero, negativo, NaN, string e nulo são ignorados', () => {
    for (const v of [0, -1, NaN, Infinity, 'muitos', null, undefined, {}]) {
      const r = getModelContextLimitInfo('gpt-4o', { 'gpt-4o': v as any })
      expect(r.limit, String(v)).toBe(128_000) // cai na tabela, não no lixo
    }
  })

  it('mapa ausente ou vazio é inofensivo', () => {
    expect(getModelContextLimit('gpt-4o', undefined)).toBe(128_000)
    expect(getModelContextLimit('gpt-4o', {})).toBe(128_000)
  })

  it('valor fracionário é truncado, não propagado', () => {
    expect(getModelContextLimit('x', { x: 1024.9 })).toBe(1024)
  })
})

describe('Ollama continua sendo o num_ctx do usuário', () => {
  it('o aprendido NÃO sobrepõe a escolha local (limite de VRAM, não do modelo)', () => {
    expect(effectiveContextLimit('ollama', 'llama3.2', 16_384, { 'llama3.2': 128_000 })).toBe(16_384)
  })

  it('mas na nuvem o aprendido vale', () => {
    expect(effectiveContextLimit('sensenova', 'sensenova-6.8-flash-lite', 8192, { 'sensenova-6.8-flash-lite': 262_144 }))
      .toBe(262_144)
  })
})

describe('o efeito chega ao orçamento do turno', () => {
  it('aprender a janela real multiplica o espaço da história', () => {
    const overhead = { systemTokens: 2000, toolTokens: 3000, responseReserve: 2048 }
    const desconhecido = computeMessageBudget(effectiveContextLimit('x', 'modelo-novo'), overhead)
    const aprendido = computeMessageBudget(
      effectiveContextLimit('x', 'modelo-novo', undefined, { 'modelo-novo': 262_144 }), overhead)
    expect(desconhecido).toBeLessThan(1_500)
    expect(aprendido).toBeGreaterThan(200_000)
  })

  it('deferral de tools deixa de disparar por modelo desconhecido', () => {
    expect(isKnownModelLimit('sensenova', 'qualquer-coisa')).toBe(false)
    expect(isKnownModelLimit('sensenova', 'qualquer-coisa', { 'qualquer-coisa': 262_144 })).toBe(true)
  })
})

describe('o main.js precisa DEVOLVER as janelas (senão nada disso roda)', () => {
  const main = readFileSync('electron/main.js', 'utf-8')

  it('o handler de modelos monta e retorna `limits`', () => {
    const i = main.indexOf("ipcMain.handle('list-provider-models'")
    expect(i).toBeGreaterThan(-1)
    const bloco = main.slice(i, i + 6000)
    expect(bloco).toContain('resolve({ models, limits, error: null })')
  })

  it('cobre os nomes de campo dos provedores que usamos', () => {
    // Anthropic, OpenRouter, Gemini — cada um chama de um jeito.
    for (const campo of ['max_input_tokens', 'context_length', 'inputTokenLimit'])
      expect(main, campo).toContain(campo)
  })
})
