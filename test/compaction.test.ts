import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  flattenForCompaction, clipToolResult, buildCompactionMessages, mergeSummary, runCompaction,
  planEmergencyCompaction, EMERGENCY_KEEP_RECENT, SUMMARY_MAX_CHARS,
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

describe('mergeSummary', () => {
  it('concatenates under the cap', () => {
    expect(mergeSummary('a', 'b')).toBe('a\n\nb')
    expect(mergeSummary('', 'b')).toBe('b')
  })

  it('keeps the TAIL when over the cap and drops the partial first line', () => {
    const prev = 'linha antiga perdida\n' + 'x'.repeat(SUMMARY_MAX_CHARS)
    const out = mergeSummary(prev, 'resumo novo')
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS)
    expect(out).toContain('resumo novo')
    expect(out.startsWith('x')).toBe(true) // partial leading line dropped
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

  it('keeps Ollama on the dedicated local handler', async () => {
    const compactContext = vi.fn().mockResolvedValue({ summary: 'resumo local', error: null })
    ;(window as any).electron.compactContext = compactContext
    const res = await runCompaction(
      { provider: 'ollama', model: 'llama3', isNotOllama: false },
      [{ role: 'user', content: 'oi' }], 'pt',
    )
    expect(res.summary).toBe('resumo local')
    expect(compactContext).toHaveBeenCalledTimes(1)
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
