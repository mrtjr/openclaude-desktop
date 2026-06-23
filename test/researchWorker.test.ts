import { describe, it, expect } from 'vitest'
import {
  buildWorkerTools, parseRawToolCalls, normalizeWorkerChat, summarizeToolsUsed,
  runResearchWorker, runWithConcurrency, resolveSubagentModel, pickFallbackModel, applySubagentModels,
  WORKER_TOOL_NAMES,
  canDelegateAtDepth, normalizeMaxDepth, workerToolNamesForDepth, buildWorkerToolsForDepth,
  capNestedSubtasks, workerSystemPrompt, DELEGATE_TOOL_NAME, NESTED_FANOUT_CAP, SUBAGENT_MAX_DEPTH_CAP,
  type WorkerChat, type WorkerExec, type WorkerChatResult,
} from '../src/utils/researchWorker'

const ALL_TOOLS = [
  { type: 'function', function: { name: 'web_search', parameters: {} } },
  { type: 'function', function: { name: 'fetch_url', parameters: {} } },
  { type: 'function', function: { name: 'read_file', parameters: {} } },
  { type: 'function', function: { name: 'search_files', parameters: {} } },
  { type: 'function', function: { name: 'list_directory', parameters: {} } },
  { type: 'function', function: { name: 'write_file', parameters: {} } },     // não-worker
  { type: 'function', function: { name: 'execute_command', parameters: {} } }, // não-worker
]

describe('buildWorkerTools', () => {
  it('filtra só as ferramentas de leitura/pesquisa da allowlist', () => {
    const names = buildWorkerTools(ALL_TOOLS).map(t => t.function.name)
    expect(names.sort()).toEqual(['fetch_url', 'list_directory', 'read_file', 'search_files', 'web_search'])
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('execute_command')
  })
  it('tolera entrada inválida', () => {
    expect(buildWorkerTools(undefined as any)).toEqual([])
  })
})

describe('parseRawToolCalls', () => {
  it('parseia argumentos como string JSON (OpenAI/Modal)', () => {
    const tcs = parseRawToolCalls([{ id: 'a', function: { name: 'web_search', arguments: '{"query":"x"}' } }])
    expect(tcs).toEqual([{ id: 'a', name: 'web_search', args: { query: 'x' } }])
  })
  it('parseia argumentos já como objeto (Ollama)', () => {
    const tcs = parseRawToolCalls([{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }])
    expect(tcs[0]).toMatchObject({ name: 'read_file', args: { path: 'a.ts' } })
    expect(tcs[0].id).toBeTruthy() // id sintetizado quando ausente
  })
  it('ignora entradas sem nome e JSON inválido vira {}', () => {
    const tcs = parseRawToolCalls([{ function: {} }, { function: { name: 'x', arguments: 'não-json' } }])
    expect(tcs).toEqual([{ id: 'wc_0', name: 'x', args: {} }]) // índice é pós-filtro
  })
})

describe('normalizeWorkerChat', () => {
  it('extrai content + tool_calls do corpo OpenAI', () => {
    const r = normalizeWorkerChat({ choices: [{ message: { content: 'oi', tool_calls: [{ id: '1', function: { name: 'web_search', arguments: '{}' } }] } }] })
    expect(r.content).toBe('oi')
    expect(r.toolCalls[0].name).toBe('web_search')
  })
  it('propaga erro de transporte e de corpo', () => {
    expect(normalizeWorkerChat(null, 'timeout').error).toBe('timeout')
    expect(normalizeWorkerChat({ error: 'HTTP 500' }).error).toBe('HTTP 500')
  })
})

describe('summarizeToolsUsed', () => {
  it('conta repetições', () => {
    expect(summarizeToolsUsed(['web_search', 'web_search', 'fetch_url'])).toBe('web_search×2, fetch_url')
  })
})

// chat stub que segue um roteiro de respostas
const scriptedChat = (script: WorkerChatResult[]): { chat: WorkerChat; calls: WorkerMessage[][][] } => {
  const calls: any[] = []
  let i = 0
  const chat: WorkerChat = async (messages, tools) => {
    calls.push([messages.map(m => m.role), tools.map((t: any) => t.function?.name)])
    return script[Math.min(i++, script.length - 1)]
  }
  return { chat, calls }
}

describe('runResearchWorker', () => {
  it('executa a ferramenta pedida, realimenta o resultado e devolve a síntese final', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [{ id: '1', name: 'web_search', args: { query: 'react 20' } }] },
      { content: 'A última versão é a 20.2.', toolCalls: [] },
    ])
    const execd: string[] = []
    const exec: WorkerExec = async (n) => { execd.push(n); return 'resultado da busca: React 20.2' }
    const out = await runResearchWorker({ messages: [{ role: 'user', content: 'qual a versão' }], tools: [], chat, exec })
    expect(out.text).toBe('A última versão é a 20.2.')
    expect(out.toolsUsed).toEqual(['web_search'])
    expect(execd).toEqual(['web_search'])
    expect(out.capped).toBeFalsy()
  })

  it('o executor injetado é a fronteira: uma tool fora da allowlist devolve erro, não roda', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [{ id: '1', name: 'write_file', args: { path: 'x', content: 'y' } }] },
      { content: 'não consegui escrever, sou read-only', toolCalls: [] },
    ])
    let wrote = false
    const exec: WorkerExec = async (n) => {
      if (!WORKER_TOOL_NAMES.has(n)) return `[ferramenta "${n}" indisponível para subagente]`
      wrote = true; return 'ok'
    }
    const out = await runResearchWorker({ messages: [{ role: 'user', content: 'apague tudo' }], tools: [], chat, exec })
    expect(wrote).toBe(false)
    expect(out.text).toContain('read-only')
  })

  it('no teto de passos força uma síntese final SEM ferramentas', async () => {
    // Sempre pede ferramenta → nunca conclui sozinho; o nudge final encerra.
    const loopCall: WorkerChatResult = { content: '', toolCalls: [{ id: '1', name: 'web_search', args: {} }] }
    let lastTools: any[] = ['sentinel']
    const chat: WorkerChat = async (_m, tools) => {
      lastTools = tools
      return tools.length === 0 ? { content: 'síntese forçada', toolCalls: [] } : loopCall
    }
    const exec: WorkerExec = async () => 'mais dados'
    const out = await runResearchWorker({
      messages: [{ role: 'user', content: 'pesquise pra sempre' }], tools: [{ function: { name: 'web_search' } }],
      chat, exec, maxSteps: 3, finalNudge: 'sintetize agora',
    })
    expect(out.capped).toBe(true)
    expect(out.text).toBe('síntese forçada')
    expect(lastTools).toEqual([]) // a chamada de síntese final não recebe ferramentas
  })

  it('emite onProgress a cada passo com ferramentas (painel ao vivo)', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [{ id: '1', name: 'web_search', args: {} }] },
      { content: '', toolCalls: [{ id: '2', name: 'fetch_url', args: {} }] },
      { content: 'pronto', toolCalls: [] },
    ])
    const progress: any[] = []
    await runResearchWorker({
      messages: [{ role: 'user', content: 'x' }], tools: [], chat, exec: async () => 'ok',
      onProgress: (p) => progress.push(p),
    })
    expect(progress).toEqual([
      { step: 1, toolsUsed: ['web_search'], lastTool: 'web_search' },
      { step: 2, toolsUsed: ['web_search', 'fetch_url'], lastTool: 'fetch_url' },
    ])
  })

  it('para no isStopped sem chamar o modelo de novo', async () => {
    let calls = 0
    const chat: WorkerChat = async () => { calls++; return { content: 'x', toolCalls: [] } }
    const out = await runResearchWorker({
      messages: [{ role: 'user', content: 'oi' }], tools: [], chat, exec: async () => '', isStopped: () => true,
    })
    expect(calls).toBe(0)
    expect(out.text).toContain('cancelado')
  })

  it('erro de transporte encerra o worker honestamente', async () => {
    const { chat } = scriptedChat([{ content: '', toolCalls: [], error: 'Ollama offline' }])
    const out = await runResearchWorker({ messages: [{ role: 'user', content: 'x' }], tools: [], chat, exec: async () => '' })
    expect(out.error).toBe(true)
    expect(out.text).toContain('Ollama offline')
  })
})

describe('resolveSubagentModel', () => {
  const allowed = ['llama3.2', 'qwen2.5-coder', 'mistral']
  it('honra o pedido do orquestrador se estiver na lista', () => {
    expect(resolveSubagentModel('qwen2.5-coder', 0, allowed, 'llama3.2')).toBe('qwen2.5-coder')
  })
  it('pedido fora da lista → rodízio pelo índice (não 404 num modelo não instalado)', () => {
    expect(resolveSubagentModel('gpt-9', 0, allowed, 'fb')).toBe('llama3.2')
    expect(resolveSubagentModel('gpt-9', 1, allowed, 'fb')).toBe('qwen2.5-coder')
    expect(resolveSubagentModel(undefined, 3, allowed, 'fb')).toBe('llama3.2') // 3 % 3 = 0
  })
  it('sem lista configurada → respeita o pedido ou cai no fallback', () => {
    expect(resolveSubagentModel('qualquer', 0, [], 'fb')).toBe('qualquer')
    expect(resolveSubagentModel(undefined, 0, [], 'fb')).toBe('fb')
  })
})

describe('pickFallbackModel (retry quando um worker falha — v2.83.1)', () => {
  it('prefere OUTRO modelo da lista permitida (não o que falhou)', () => {
    // caso real: 9b falha por VRAM, mas o qwen3:8b da mesma lista entrega
    expect(pickFallbackModel('huihui_ai/qwen3.5-abliterated:9b', ['huihui_ai/qwen3.5-abliterated:9b', 'qwen3:8b'], 'llama3.2'))
      .toBe('qwen3:8b')
  })
  it('cai no fallback fixo se a lista não tem alternativa distinta', () => {
    expect(pickFallbackModel('m', ['m'], 'fb')).toBe('fb')
    expect(pickFallbackModel('m', [], 'fb')).toBe('fb')
  })
  it('devolve "" quando não há alternativa distinta (→ sem retry)', () => {
    expect(pickFallbackModel('m', ['m'], 'm')).toBe('')
    expect(pickFallbackModel('m', [], 'm')).toBe('')
    expect(pickFallbackModel('m', [], '')).toBe('')
  })
})

describe('applySubagentModels', () => {
  const TOOLS = [
    { type: 'function', function: { name: 'read_file', description: 'lê' } },
    { type: 'function', function: { name: 'delegate_subtasks', description: 'delega.' } },
  ]
  it('injeta a lista na descrição só do delegate_subtasks, sem mutar', () => {
    const out = applySubagentModels(TOOLS, ['llama3.2', 'mistral'])
    const del = out.find(t => t.function.name === 'delegate_subtasks')!
    expect(del.function.description).toContain('llama3.2, mistral')
    expect(out.find(t => t.function.name === 'read_file')!.function.description).toBe('lê')
    expect(TOOLS[1].function.description).toBe('delega.') // entrada intacta
  })
  it('lista vazia → retorna o array original', () => {
    expect(applySubagentModels(TOOLS, [])).toBe(TOOLS)
  })
})

// ─── Subagentes aninhados (v2.88.0) ─────────────────────────────────
describe('canDelegateAtDepth', () => {
  it('permite delegar enquanto a profundidade tem orçamento (depth < maxDepth)', () => {
    expect(canDelegateAtDepth(1, 2)).toBe(true)  // worker raiz com maxDepth 2 pode aninhar
    expect(canDelegateAtDepth(2, 2)).toBe(false) // filho no fundo não delega mais
    expect(canDelegateAtDepth(1, 1)).toBe(false) // maxDepth 1 = sem aninhamento
    expect(canDelegateAtDepth(2, 3)).toBe(true)
  })
  it('coage entradas inválidas (maxDepth mínimo 1)', () => {
    expect(canDelegateAtDepth(1, 0 as any)).toBe(false)
    expect(canDelegateAtDepth(1, NaN as any)).toBe(false)
  })
})

describe('normalizeMaxDepth', () => {
  it('mantém valores válidos e fixa o intervalo [1, teto]', () => {
    expect(normalizeMaxDepth(2)).toBe(2)
    expect(normalizeMaxDepth(0)).toBe(1)
    expect(normalizeMaxDepth(99)).toBe(SUBAGENT_MAX_DEPTH_CAP)
    expect(normalizeMaxDepth(undefined)).toBe(2) // default
    expect(normalizeMaxDepth('3' as any)).toBe(3)
  })
})

describe('workerToolNamesForDepth / buildWorkerToolsForDepth', () => {
  const ALL = [
    ...['web_search', 'fetch_url', 'read_file', 'search_files', 'list_directory'].map(n => ({ type: 'function', function: { name: n } })),
    { type: 'function', function: { name: 'delegate_subtasks' } },
    { type: 'function', function: { name: 'write_file' } },
  ]
  it('inclui delegate_subtasks só quando a profundidade ainda permite aninhar', () => {
    expect(workerToolNamesForDepth(1, 2).has(DELEGATE_TOOL_NAME)).toBe(true)
    expect(workerToolNamesForDepth(2, 2).has(DELEGATE_TOOL_NAME)).toBe(false)
    // leitura sempre presente
    expect(workerToolNamesForDepth(2, 2).has('web_search')).toBe(true)
  })
  it('filtra os schemas reais por profundidade (delegate só no nível permitido)', () => {
    const deep = buildWorkerToolsForDepth(ALL, 1, 2).map(t => t.function.name)
    expect(deep).toContain('delegate_subtasks')
    expect(deep).not.toContain('write_file')
    const leaf = buildWorkerToolsForDepth(ALL, 2, 2).map(t => t.function.name)
    expect(leaf).not.toContain('delegate_subtasks')
    expect(leaf).toContain('read_file')
  })
})

describe('capNestedSubtasks', () => {
  it('limita o fan-out de uma delegação aninhada ao teto', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ prompt: `t${i}` }))
    expect(capNestedSubtasks(many).length).toBe(NESTED_FANOUT_CAP)
    expect(capNestedSubtasks(many, 2).length).toBe(2)
  })
  it('tolera entrada inválida', () => {
    expect(capNestedSubtasks(undefined as any)).toEqual([])
  })
})

describe('workerSystemPrompt', () => {
  it('adiciona a cláusula de delegação só quando o worker pode aninhar', () => {
    expect(workerSystemPrompt('pt', true)).toContain('delegate_subtasks')
    expect(workerSystemPrompt('pt', false)).not.toContain('delegate_subtasks')
    expect(workerSystemPrompt('en', true)).toContain('delegate_subtasks')
  })
  it('cai no PT para idioma desconhecido', () => {
    expect(workerSystemPrompt('zz', false)).toBe(workerSystemPrompt('pt', false))
  })
})

describe('runResearchWorker — aninhamento via executor injetado', () => {
  it('o worker pode chamar delegate_subtasks e o executor roda os filhos', async () => {
    // 1º passo: o worker delega; 2º passo: sintetiza com o que o filho devolveu.
    const { chat } = scriptedChat([
      { content: '', toolCalls: [{ id: '1', name: 'delegate_subtasks', args: { subtasks: [{ prompt: 'sub' }] } }] },
      { content: 'síntese com base no filho', toolCalls: [] },
    ])
    let delegated = false
    const exec: WorkerExec = async (n, a) => {
      if (n === 'delegate_subtasks') { delegated = true; return `[filho]: ${(a.subtasks?.[0]?.prompt) || ''} ok` }
      return '[indisponível]'
    }
    const tools = buildWorkerToolsForDepth(
      [{ type: 'function', function: { name: 'delegate_subtasks' } }], 1, 2)
    const out = await runResearchWorker({ messages: [{ role: 'user', content: 'investigue A' }], tools, chat, exec })
    expect(delegated).toBe(true)
    expect(out.toolsUsed).toEqual(['delegate_subtasks'])
    expect(out.text).toBe('síntese com base no filho')
  })
})

describe('runWithConcurrency', () => {
  it('preserva a ordem dos resultados e respeita o teto', async () => {
    let active = 0, peak = 0
    const thunks = Array.from({ length: 7 }, (_, i) => async () => {
      active++; peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return i
    })
    const out = await runWithConcurrency(thunks, 3)
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(peak).toBeLessThanOrEqual(3)
  })
  it('lida com lista vazia', async () => {
    expect(await runWithConcurrency([], 4)).toEqual([])
  })
})

describe('isStopped — interrompe ENTRE passos (base do Parar dos subagentes, v2.126.0)', () => {
  it('para no meio do loop após o 1º passo, sem chamar o modelo de novo', async () => {
    let stopped = false
    let calls = 0
    const chat: WorkerChat = async () => {
      calls++
      return { content: '', toolCalls: [{ id: String(calls), name: 'web_search', args: {} }] }
    }
    const exec: WorkerExec = async () => { stopped = true; return 'dados' } // simula o Parar durante a 1ª tool
    const out = await runResearchWorker({
      messages: [{ role: 'user', content: 'x' }], tools: [], chat, exec,
      isStopped: () => stopped, maxSteps: 5,
    })
    expect(calls).toBe(1)               // só o 1º passo rodou
    expect(out.text).toContain('cancelado')
  })
})
