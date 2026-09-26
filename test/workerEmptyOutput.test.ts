// ─── Worker que devolve branco (v2.210.0) ───────────────────────────
//
// Reproduzido de um caso REAL nos logs: três subagentes fizeram trabalho
// pesado (26 fetch_url, 14 fetch_url, 2 web_search) e devolveram bolha VAZIA,
// sem nenhuma mensagem de erro. Duas causas somadas:
//   1. `"\n\n"` é TRUTHY, então virava `last` como se fosse resposta;
//   2. o retorno de erro era `last || <erro>` — havendo `last`, a mensagem de
//      falha era DESCARTADA.

import { describe, it, expect } from 'vitest'
import { runResearchWorker, type WorkerChat } from '../src/utils/researchWorker'

const TOOLS = [{ type: 'function', function: { name: 'fetch_url' } }]
const base = { messages: [{ role: 'user' as const, content: 'investigue' }], tools: TOOLS, exec: async () => 'ok' }

describe('o erro do worker nunca pode ser engolido', () => {
  it('falha DEPOIS de trabalho útil ainda reporta a causa', async () => {
    // Era o caso real: tools rodam, o provider falha, e o usuário via branco.
    let n = 0
    const chat: WorkerChat = async () => {
      n++
      if (n === 1) return { content: '', toolCalls: [{ id: 'c1', name: 'fetch_url', args: {} }] }
      return { content: '', toolCalls: [], error: 'HTTP 429: rate limited' }
    }
    const out = await runResearchWorker({ ...base, chat, maxSteps: 4 })
    expect(out.error).toBe(true)
    expect(out.text).toContain('429')
    expect(out.text.trim().length).toBeGreaterThan(10)
  })

  it('texto parcial NÃO apaga a causa — vem etiquetado junto', async () => {
    let n = 0
    const chat: WorkerChat = async () => {
      n++
      if (n === 1) return { content: 'achei o endpoint /api/v2', toolCalls: [{ id: 'c1', name: 'fetch_url', args: {} }] }
      return { content: '', toolCalls: [], error: 'socket hang up' }
    }
    const out = await runResearchWorker({ ...base, chat, maxSteps: 4 })
    expect(out.error).toBe(true)
    expect(out.text).toContain('socket hang up')
    expect(out.text).toContain('PARCIAL')
    expect(out.text).toContain('/api/v2')   // o trabalho feito não se perde
  })
})

describe('espaço em branco não conta como resposta', () => {
  it('conteúdo só com quebras de linha não vira `last`', async () => {
    let n = 0
    const chat: WorkerChat = async () => {
      n++
      if (n === 1) return { content: '\n\n  \n', toolCalls: [{ id: 'c1', name: 'fetch_url', args: {} }] }
      return { content: '', toolCalls: [], error: 'boom' }
    }
    const out = await runResearchWorker({ ...base, chat, maxSteps: 4 })
    // Antes: `last` = "\n\n  \n" (truthy) e o texto devolvido era esse branco.
    expect(out.text).toContain('boom')
    expect(out.text).not.toContain('PARCIAL')
  })

  it('worker que encerra sem texto diz isso, em vez de devolver vazio', async () => {
    const chat: WorkerChat = async () => ({ content: '   \n ', toolCalls: [] })
    const out = await runResearchWorker({ ...base, chat, maxSteps: 4 })
    expect(out.error).toBe(true)
    expect(out.text).toMatch(/sem produzir texto/i)
    // O orquestrador não tem como distinguir "não achei" de "quebrei" olhando branco.
    expect(out.text.trim().length).toBeGreaterThan(10)
  })
})

describe('o caminho feliz não regrediu', () => {
  it('resposta normal passa intacta e sem flag de erro', async () => {
    const chat: WorkerChat = async () => ({ content: 'Achados: A, B. Conclusão: C.', toolCalls: [] })
    const out = await runResearchWorker({ ...base, chat, maxSteps: 4 })
    expect(out.error).toBeFalsy()
    expect(out.text).toBe('Achados: A, B. Conclusão: C.')
  })

  it('trabalho com ferramentas e síntese no fim continua funcionando', async () => {
    let n = 0
    const chat: WorkerChat = async () => {
      n++
      if (n === 1) return { content: '', toolCalls: [{ id: 'c1', name: 'fetch_url', args: {} }] }
      return { content: 'Síntese final.', toolCalls: [] }
    }
    const out = await runResearchWorker({ ...base, chat, maxSteps: 4 })
    expect(out.error).toBeFalsy()
    expect(out.text).toBe('Síntese final.')
    expect(out.toolsUsed).toEqual(['fetch_url'])
  })
})
