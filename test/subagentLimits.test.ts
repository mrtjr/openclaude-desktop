// ─── Limites e honestidade de falha dos subagentes (v2.201.0) ────────
//
// Quatro buracos que faziam o enxame parecer "burro" ou entregar trabalho
// incompleto com cara de conclusão. Cada teste trava um deles.

import { describe, it, expect } from 'vitest'
import {
  ROOT_FANOUT_CAP, NESTED_FANOUT_CAP, capNestedSubtasks,
  WORKER_TOOL_NAMES, buildWorkerTools, runResearchWorker,
  type WorkerChat,
} from '../src/utils/researchWorker'

describe('teto de fan-out da RAIZ', () => {
  it('a raiz tem teto próprio, mais largo que o aninhado', () => {
    expect(ROOT_FANOUT_CAP).toBeGreaterThan(NESTED_FANOUT_CAP)
    expect(ROOT_FANOUT_CAP).toBeGreaterThanOrEqual(4)
  })

  it('um lote obeso é cortado no teto — e o corte é mensurável', () => {
    const pedidas = Array.from({ length: 20 }, (_, i) => ({ prompt: `t${i}` }))
    const rodadas = pedidas.slice(0, ROOT_FANOUT_CAP)
    expect(rodadas).toHaveLength(ROOT_FANOUT_CAP)
    expect(pedidas.length - rodadas.length).toBe(20 - ROOT_FANOUT_CAP)
  })

  it('o cap aninhado segue mais apertado (roda dentro da vaga do pai)', () => {
    expect(capNestedSubtasks(Array.from({ length: 9 }, (_, i) => i))).toHaveLength(NESTED_FANOUT_CAP)
  })
})

describe('allowlist do worker — mapeamento de repositório', () => {
  it('inclui glob_files e project_tree (ambas read-only)', () => {
    expect(WORKER_TOOL_NAMES.has('glob_files')).toBe(true)
    expect(WORKER_TOOL_NAMES.has('project_tree')).toBe(true)
  })

  it('a fronteira de segurança continua fechada para escrita/execução', () => {
    for (const proibida of ['write_file', 'edit_file', 'execute_command', 'git_command', 'run_workflow']) {
      expect(WORKER_TOOL_NAMES.has(proibida)).toBe(false)
    }
  })

  it('buildWorkerTools passa a entregar os schemas das duas novas', () => {
    const fake = ['read_file', 'glob_files', 'project_tree', 'write_file']
      .map(n => ({ type: 'function', function: { name: n } }))
    const nomes = buildWorkerTools(fake).map((t: any) => t.function.name)
    expect(nomes).toContain('glob_files')
    expect(nomes).toContain('project_tree')
    expect(nomes).not.toContain('write_file')
  })
})

describe('falha na síntese final não é mais reportada como sucesso', () => {
  // Worker que sempre pede ferramenta (nunca conclui) → estoura o teto de
  // passos; depois a síntese final falha. Antes, ter texto parcial zerava o
  // flag de erro e o run era contado como OK.
  const chatQueFalhaNaSintese = (comParcial: boolean): WorkerChat => {
    let n = 0
    return async (_msgs, tools) => {
      const ehSintese = !tools || tools.length === 0
      if (ehSintese) return { content: '', toolCalls: [], error: 'boom' }
      n++
      return {
        content: comParcial ? `parcial ${n}` : '',
        toolCalls: [{ id: `c${n}`, name: 'read_file', args: {} }],
      }
    }
  }

  it('marca error mesmo havendo texto parcial acumulado', async () => {
    const out = await runResearchWorker({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'read_file' } }],
      chat: chatQueFalhaNaSintese(true),
      exec: async () => 'ok',
      finalNudge: 'sintetize',
      maxSteps: 2,
    })
    expect(out.error).toBe(true)
    expect(out.capped).toBe(true)
  })

  it('etiqueta o texto parcial para o orquestrador não tratar como conclusão', async () => {
    const out = await runResearchWorker({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'read_file' } }],
      chat: chatQueFalhaNaSintese(true),
      exec: async () => 'ok',
      finalNudge: 'sintetize',
      maxSteps: 2,
    })
    expect(out.text).toMatch(/SÍNTESE FINAL FALHOU/)
    expect(out.text).toMatch(/PARCIAL/)
    expect(out.text).toContain('parcial')
  })

  it('sem texto parcial, continua reportando o erro cru', async () => {
    const out = await runResearchWorker({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'read_file' } }],
      chat: chatQueFalhaNaSintese(false),
      exec: async () => 'ok',
      finalNudge: 'sintetize',
      maxSteps: 2,
    })
    expect(out.error).toBe(true)
    expect(out.text).toContain('boom')
  })
})

describe('capped sinaliza truncamento', () => {
  it('worker que conclui sozinho NÃO vem marcado como truncado', async () => {
    const out = await runResearchWorker({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      chat: async () => ({ content: 'pronto', toolCalls: [] }),
      exec: async () => 'ok',
      maxSteps: 4,
    })
    expect(out.capped).toBeFalsy()
    expect(out.error).toBeFalsy()
    expect(out.text).toBe('pronto')
  })
})
