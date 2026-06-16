import { describe, it, expect } from 'vitest'
import {
  buildWorkerTools, parseRawToolCalls, normalizeWorkerChat, summarizeToolsUsed,
  runResearchWorker, runWithConcurrency, WORKER_TOOL_NAMES,
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
