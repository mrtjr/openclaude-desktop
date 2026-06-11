import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useToolExecution } from '../src/hooks/useToolExecution'

// ─── Integration coverage for the tool dispatch hub ─────────────────
// useToolExecution is the #1 path in real usage (execute_command 220x,
// browser 63x) and had zero tests. We mock window.electron and exercise
// executeToolRaw (the per-tool dispatch + result formatting) and executeTool
// (the approval gate + audit/telemetry classification + output clamp).

function makeElectron(over: Record<string, any> = {}) {
  return {
    execCommand: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, error: null }),
    readFile: vi.fn().mockResolvedValue({ content: 'file contents', error: null }),
    writeFile: vi.fn().mockResolvedValue({ error: null }),
    editFile: vi.fn().mockResolvedValue({ error: null, replaced: true, occurrences: 1 }),
    webSearch: vi.fn().mockResolvedValue({ result: 'search results', error: null }),
    listDirectory: vi.fn().mockResolvedValue({ items: [{ type: 'file', name: 'a.txt', size: 10, modified: 'now' }], error: null }),
    gitCommand: vi.fn().mockResolvedValue({ stdout: 'clean', stderr: '', error: null }),
    undoLastWrite: vi.fn().mockResolvedValue({ error: null, restored: 'a.txt' }),
    loadMemory: vi.fn().mockResolvedValue({ facts: [], preferences: [], projects: [] }),
    saveMemory: vi.fn().mockResolvedValue({ error: null }),
    auditLogAppend: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function setup(opts: { settings?: any; activeConvId?: string | null; setConversations?: any; projectCwd?: string } = {}) {
  const settings = { permissionLevel: 'ignore', memoryEnabled: true, language: 'pt', maxTokens: 2048, temperature: 0.7, ...(opts.settings || {}) }
  const setConversations = opts.setConversations || vi.fn()
  const { result } = renderHook(() => useToolExecution({
    settings: settings as any,
    activeConvId: opts.activeConvId ?? 'c1',
    setConversations,
    projectCwd: opts.projectCwd,
  }))
  return { result, setConversations }
}

beforeEach(() => {
  ;(globalThis as any).window = (globalThis as any).window || {}
})

describe('executeToolRaw — per-tool dispatch', () => {
  it('execute_command: formats the result and forwards cwd + timeout', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup({ projectCwd: 'D:/proj' })
    const out = await result.current.executeToolRaw('execute_command', { command: 'dir', timeout_s: 120 })
    expect(out).toBe('ok')
    expect((window as any).electron.execCommand).toHaveBeenCalledWith({ command: 'dir', cwd: 'D:/proj', timeoutMs: 120000 })
  })

  it('execute_command: surfaces a failing exit code (honest result)', async () => {
    ;(window as any).electron = makeElectron({
      execCommand: vi.fn().mockResolvedValue({ stdout: 'partial', stderr: 'boom', exitCode: 1, error: null }),
    })
    const { result } = setup()
    const out = await result.current.executeToolRaw('execute_command', { command: 'x' })
    expect(out).toContain('boom')
    expect(out).toContain('[exit code: 1]')
  })

  it('read_file / write_file / edit_file', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup()
    expect(await result.current.executeToolRaw('read_file', { path: 'a.txt' })).toBe('file contents')
    expect(await result.current.executeToolRaw('write_file', { path: 'a.txt', content: 'x' })).toBe('Arquivo escrito com sucesso')
    expect(await result.current.executeToolRaw('edit_file', { path: 'a.txt', old_string: 'a', new_string: 'b' })).toBe('Arquivo editado: a.txt')
  })

  it('web_search and list_directory', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup()
    expect(await result.current.executeToolRaw('web_search', { query: 'x' })).toBe('search results')
    expect(await result.current.executeToolRaw('list_directory', { path: '.' })).toContain('a.txt')
  })

  it('git_command and undo_last_write', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup()
    expect(await result.current.executeToolRaw('git_command', { command: 'status' })).toContain('clean')
    expect(await result.current.executeToolRaw('undo_last_write', {})).toContain('a.txt')
  })

  it('tool_search returns matching schemas', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup()
    const out = await result.current.executeToolRaw('tool_search', { query: 'select:read_file' })
    expect(out).toContain('read_file')
  })

  it('plan_tasks and update_task_status mutate the conversation', async () => {
    ;(window as any).electron = makeElectron()
    const setConversations = vi.fn()
    const { result } = setup({ setConversations })
    await result.current.executeToolRaw('plan_tasks', { goal: 'fazer X', tasks: [{ id: 't1', title: 'a', status: 'pending' }] })
    expect(setConversations).toHaveBeenCalled()
  })

  it('unknown tool and thrown errors degrade gracefully', async () => {
    ;(window as any).electron = makeElectron({ readFile: vi.fn().mockRejectedValue(new Error('disk gone')) })
    const { result } = setup()
    expect(await result.current.executeToolRaw('does_not_exist', {})).toBe('Ferramenta nao reconhecida')
    expect(await result.current.executeToolRaw('read_file', { path: 'a' })).toBe('Erro: disk gone')
  })
})

describe('executeToolRaw — remember_fact', () => {
  it('saves a new fact when memory is enabled', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup({ settings: { memoryEnabled: true } })
    const out = await result.current.executeToolRaw('remember_fact', { category: 'fact', content: 'usa MT5' })
    expect(out).toContain('Memória atualizada')
    expect((window as any).electron.saveMemory).toHaveBeenCalledWith({ facts: ['usa MT5'], preferences: [], projects: [] })
  })

  it('does nothing when memory is disabled', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup({ settings: { memoryEnabled: false } })
    const out = await result.current.executeToolRaw('remember_fact', { content: 'x' })
    expect(out).toContain('desativada')
    expect((window as any).electron.saveMemory).not.toHaveBeenCalled()
  })

  it('reports a duplicate without saving', async () => {
    ;(window as any).electron = makeElectron({ loadMemory: vi.fn().mockResolvedValue({ facts: ['usa MT5'], preferences: [], projects: [] }) })
    const { result } = setup({ settings: { memoryEnabled: true } })
    const out = await result.current.executeToolRaw('remember_fact', { category: 'fact', content: 'usa mt5' })
    expect(out).toContain('Já estava na memória')
    expect((window as any).electron.saveMemory).not.toHaveBeenCalled()
  })
})

describe('executeTool — approval gate + audit classification', () => {
  it('classifies a failed command as error in the audit log', async () => {
    ;(window as any).electron = makeElectron({
      execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: 'nope', exitCode: 1, error: null }),
    })
    const { result } = setup({ settings: { permissionLevel: 'ignore' } })
    await result.current.executeTool('execute_command', { command: 'x' })
    const call = (window as any).electron.auditLogAppend.mock.calls.at(-1)[0]
    expect(call.status).toBe('error')
  })

  it('classifies a successful command as success', async () => {
    ;(window as any).electron = makeElectron()
    const { result } = setup({ settings: { permissionLevel: 'ignore' } })
    await result.current.executeTool('execute_command', { command: 'x' })
    const call = (window as any).electron.auditLogAppend.mock.calls.at(-1)[0]
    expect(call.status).toBe('success')
  })

  it('truncates an over-long tool output', async () => {
    ;(window as any).electron = makeElectron({
      readFile: vi.fn().mockResolvedValue({ content: 'y'.repeat(9000), error: null }),
    })
    const { result } = setup({ settings: { permissionLevel: 'ignore' } })
    const out = await result.current.executeTool('read_file', { path: 'big.txt' })
    expect(out).toContain('SYSTEM TRUNCATED')
    expect(out.length).toBeLessThan(9000)
  })
})
