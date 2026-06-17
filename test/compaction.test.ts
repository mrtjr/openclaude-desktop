import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  flattenForCompaction, clipToolResult, buildCompactionMessages, mergeSummary, runCompaction,
  planEmergencyCompaction, EMERGENCY_KEEP_RECENT,
} from '../src/services/compaction'

describe('flattenForCompaction', () => {
  it('includes role-tagged content AND tool results (agent convs are mostly tool traffic)', () => {
    const out = flattenForCompaction([
      { role: 'user', content: 'rode os testes' },
      {
        role: 'assistant', content: 'ok',
        toolCalls: [{ id: 't1', name: 'execute_command', arguments: { command: 'npm test' } }],
        toolResults: [{ toolCallId: 't1', name: 'execute_command', result: '409 passed' }],
      } as any,
    ])
    expect(out).toContain('[user]: rode os testes')
    expect(out).toContain('[tool execute_command]: 409 passed')
  })

  it('clips long content and tool results', () => {
    const out = flattenForCompaction([
      { role: 'user', content: 'x'.repeat(900) },
      { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'read_file', arguments: {} }], toolResults: [{ toolCallId: 't', name: 'read_file', result: 'y'.repeat(900) }] } as any,
    ], 500, 300)
    const lines = out.split('\n')
    expect(lines[0].length).toBeLessThanOrEqual(500 + '[user]: '.length)
    expect(lines[1].length).toBeLessThanOrEqual(300 + '[tool read_file]: '.length)
  })

  it('keeps the TAIL of a long tool result (exit code/stderr live at the end)', () => {
    const longResult = 'INICIO_DO_BUILD\n' + 'x'.repeat(3000) + '\n--- stderr ---\nfalhou\n[exit code: 1]'
    const out = flattenForCompaction([
      { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'execute_command', arguments: { command: 'npm run build' } }], toolResults: [{ toolCallId: 't', name: 'execute_command', result: longResult }] } as any,
    ])
    expect(out).toContain('INICIO_DO_BUILD')   // head preserved
    expect(out).toContain('[exit code: 1]')    // tail preserved (was dropped before)
    expect(out).toContain('falhou')
    expect(out).toContain('…[corte]…')         // middle elided
  })
})

describe('planEmergencyCompaction', () => {
  it('summarizes the middle, preserving the prefix and the recent tail', () => {
    // prefix=3, total=20, keepRecent=4 → region [3,16), tail starts at 16
    const plan = planEmergencyCompaction(20, 3, 4)
    expect(plan).toEqual({ regionStart: 3, regionEnd: 16, tailStart: 16 })
  })

  it('uses the default keepRecent', () => {
    const plan = planEmergencyCompaction(30, 5)
    expect(plan).toEqual({ regionStart: 5, regionEnd: 30 - EMERGENCY_KEEP_RECENT, tailStart: 30 - EMERGENCY_KEEP_RECENT })
  })

  it('returns null when there is nothing between the prefix and the kept tail', () => {
    // prefix=5, total=8, keepRecent=4 → tailStart=max(5,4)=5, region empty
    expect(planEmergencyCompaction(8, 5, 4)).toBeNull()
    expect(planEmergencyCompaction(5, 5, 4)).toBeNull()
    expect(planEmergencyCompaction(3, 5, 4)).toBeNull()
  })
})

describe('clipToolResult', () => {
  it('returns short results unchanged', () => {
    expect(clipToolResult('curto', 100)).toBe('curto')
  })
  it('keeps head + tail with an elision marker when over the cap', () => {
    const r = 'HEAD' + 'm'.repeat(500) + 'TAIL'
    const out = clipToolResult(r, 60)
    expect(out.startsWith('HEAD')).toBe(true)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(out).toContain('…[corte]…')
    expect(out.length).toBeLessThan(r.length)
  })
})

describe('buildCompactionMessages', () => {
  it('builds pt prompt + transcript', () => {
    const msgs = buildCompactionMessages([{ role: 'user', content: 'oi' }], 'pt')
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Resuma a conversa')
    expect(msgs[1].content).toContain('[user]: oi')
  })

  it('appends custom instructions to the prompt (/compact <instruções> works now)', () => {
    const msgs = buildCompactionMessages([{ role: 'user', content: 'oi' }], 'pt', 'foque nos preços')
    expect(msgs[0].content).toContain('Instruções adicionais do usuário: foque nos preços')
  })
})

describe('mergeSummary (estruturado, v2.59.0)', () => {
  it('funde seções e deduplica em vez de concatenar', () => {
    const prev = '## Objetivo\n- corrigir o login\n## Fatos-chave\n- usa OAuth'
    const next = '## Fatos-chave\n- usa OAuth\n- token expira em 1h\n## Estado atual\n- login corrigido'
    const out = mergeSummary(prev, next)
    expect(out).toContain('## Objetivo')
    expect(out).toContain('corrigir o login')
    // "usa OAuth" aparece nas duas entradas mas só uma vez na saída (dedup)
    expect(out.match(/usa OAuth/g)?.length).toBe(1)
    expect(out).toContain('token expira em 1h')
    expect(out).toContain('## Estado atual')
  })

  it('NUNCA perde o objetivo mesmo quando o volátil estoura o teto (fix do corte-de-rabo)', () => {
    const prev = '## Objetivo\n- entregar o relatório de pentest do otserv'
    const huge = Array.from({ length: 60 }, (_, i) => `- passo volátil número ${i} ${'x'.repeat(80)}`).join('\n')
    const next = `## Estado atual\n${huge}`
    const out = mergeSummary(prev, next, 1000)
    expect(out.length).toBeLessThanOrEqual(1000)
    expect(out).toContain('entregar o relatório de pentest do otserv') // durável preservado
  })

  it('texto não-estruturado (legado/importado) vai para Notas e não some', () => {
    expect(mergeSummary('', 'b')).toContain('b')
    const out = mergeSummary('contexto legado plano', 'mais contexto')
    expect(out).toContain('contexto legado plano')
    expect(out).toContain('mais contexto')
  })
})

describe('runCompaction (provider routing)', () => {
  beforeEach(() => {
    ;(window as any).electron = (window as any).electron || {}
  })

  it('routes CLOUD providers through provider-chat (the old IPC skipped them)', async () => {
    const providerChat = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'resumo cloud' } }] })
    ;(window as any).electron.providerChat = providerChat
    const res = await runCompaction(
      { provider: 'modal', model: 'zai-org/GLM-5.1-FP8', apiKey: 'k', isNotOllama: true, modalHostname: 'h' },
      [{ role: 'user', content: 'oi' }], 'pt',
    )
    expect(res).toEqual({ summary: 'resumo cloud', error: null })
    expect(providerChat).toHaveBeenCalledTimes(1)
    const params = providerChat.mock.calls[0][0]
    expect(params.provider).toBe('modal')
    expect(params.tools).toEqual([])
    expect(params.temperature).toBe(0.1)
  })

  it('surfaces provider errors without throwing', async () => {
    ;(window as any).electron.providerChat = vi.fn().mockResolvedValue({ error: 'HTTP 500' })
    const res = await runCompaction(
      { provider: 'openai', model: 'gpt-4o', isNotOllama: true },
      [{ role: 'user', content: 'oi' }], 'en',
    )
    expect(res.summary).toBe('')
    expect(res.error).toBe('HTTP 500')
  })

  it('routes Ollama through ollama-chat with the SAME structured prompt (tools + instructions, não o handler plano antigo)', async () => {
    const ollamaChat = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'resumo local' } }] })
    ;(window as any).electron.ollamaChat = ollamaChat
    const res = await runCompaction(
      { provider: 'ollama', model: 'llama3', isNotOllama: false },
      [{ role: 'user', content: 'oi' }], 'pt', 'foque nos arquivos',
    )
    expect(res).toEqual({ summary: 'resumo local', error: null })
    expect(ollamaChat).toHaveBeenCalledTimes(1)
    const params = ollamaChat.mock.calls[0][0]
    expect(params.model).toBe('llama3')
    expect(params.temperature).toBe(0.1)
    // mensagens estruturadas (system com seções + instrução do /compact)
    expect(params.messages[0].role).toBe('system')
    expect(params.messages[0].content).toContain('foque nos arquivos')
  })

  it('surfaces Ollama errors without throwing', async () => {
    ;(window as any).electron.ollamaChat = vi.fn().mockResolvedValue({ error: 'ollama down' })
    const res = await runCompaction(
      { provider: 'ollama', model: 'llama3', isNotOllama: false },
      [{ role: 'user', content: 'oi' }], 'pt',
    )
    expect(res.summary).toBe('')
    expect(res.error).toBe('ollama down')
  })

  it('never throws even when the bridge rejects', async () => {
    ;(window as any).electron.providerChat = vi.fn().mockRejectedValue(new Error('IPC morto'))
    const res = await runCompaction(
      { provider: 'modal', model: 'm', isNotOllama: true },
      [{ role: 'user', content: 'oi' }], 'pt',
    )
    expect(res.summary).toBe('')
    expect(res.error).toContain('IPC morto')
  })
})
