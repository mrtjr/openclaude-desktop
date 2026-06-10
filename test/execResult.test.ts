import { describe, it, expect } from 'vitest'
import { formatExecResult, resolveExecCwd, resolveExecTimeoutMs } from '../src/utils/execResult'

describe('formatExecResult', () => {
  it('returns stdout alone on success', () => {
    expect(formatExecResult({ stdout: 'hello\n', stderr: '', exitCode: 0, error: null })).toBe('hello')
  })

  it('keeps stderr even when stdout exists (warnings must not vanish)', () => {
    const out = formatExecResult({ stdout: 'built ok', stderr: 'warning: deprecated API', exitCode: 0, error: null })
    expect(out).toContain('built ok')
    expect(out).toContain('--- stderr ---')
    expect(out).toContain('warning: deprecated API')
  })

  it('appends the exit code on failure even when stdout was printed', () => {
    const out = formatExecResult({ stdout: 'partial output', stderr: '', exitCode: 2, error: null })
    expect(out).toContain('partial output')
    expect(out).toContain('[exit code: 2]')
  })

  it('does NOT append an exit-code line on success', () => {
    expect(formatExecResult({ stdout: 'ok', exitCode: 0 })).not.toContain('exit code')
  })

  it('reports failure with stderr + exit code', () => {
    const out = formatExecResult({ stdout: '', stderr: 'comando não reconhecido', exitCode: 1, error: null })
    expect(out).toContain('comando não reconhecido')
    expect(out).toContain('[exit code: 1]')
  })

  it('calls out a timeout kill explicitly (exec reports no exit code for it)', () => {
    const out = formatExecResult({ stdout: 'partial…', stderr: '', exitCode: 1, timedOut: true, error: null })
    expect(out).toContain('partial…')
    expect(out).toContain('tempo limite excedido')
    expect(out).not.toContain('[exit code:')
  })

  it('appends an actionable timeout_s hint on timeout when more time is requestable', () => {
    const out = formatExecResult({ stdout: '', stderr: '', exitCode: 1, timedOut: true, timeoutMs: 60000, error: null })
    expect(out).toContain('tempo limite excedido')
    expect(out).toContain('timeout_s')
    expect(out).toContain('60s')
  })

  it('omits the hint when the command already ran at the 600s cap', () => {
    const out = formatExecResult({ stdout: '', stderr: '', exitCode: 1, timedOut: true, timeoutMs: 600000, error: null })
    expect(out).toContain('tempo limite excedido')
    expect(out).not.toContain('Dica')
  })

  it('surfaces spawn-level errors when nothing was printed', () => {
    const out = formatExecResult({ stdout: '', stderr: '', exitCode: 1, error: 'Pasta de trabalho não existe: X:\\nope' })
    expect(out).toContain('Erro: Pasta de trabalho não existe')
    expect(out).toContain('[exit code: 1]')
  })

  it('says "sem saída" for a silent success', () => {
    expect(formatExecResult({ stdout: '', stderr: '', exitCode: 0, error: null })).toBe('Comando executado (sem saída)')
  })

  it('tolerates missing fields (legacy IPC shape)', () => {
    expect(formatExecResult({ stdout: 'x' })).toBe('x')
    expect(formatExecResult({})).toBe('Comando executado (sem saída)')
  })
})

describe('resolveExecTimeoutMs', () => {
  it('defaults to 60s when absent or invalid', () => {
    expect(resolveExecTimeoutMs(undefined)).toBe(60000)
    expect(resolveExecTimeoutMs(null)).toBe(60000)
    expect(resolveExecTimeoutMs('abc')).toBe(60000)
    expect(resolveExecTimeoutMs(0)).toBe(60000)
    expect(resolveExecTimeoutMs(-5)).toBe(60000)
  })
  it('converts seconds to milliseconds (models often pass numbers as strings)', () => {
    expect(resolveExecTimeoutMs(300)).toBe(300000)
    expect(resolveExecTimeoutMs('120')).toBe(120000)
  })
  it('clamps to the [1s, 600s] bounds', () => {
    expect(resolveExecTimeoutMs(0.2)).toBe(1000)
    expect(resolveExecTimeoutMs(3600)).toBe(600000)
  })
})

describe('resolveExecCwd', () => {
  it('prefers an explicit cwd from the model', () => {
    expect(resolveExecCwd('D:/outro', 'D:/projeto')).toBe('D:/outro')
  })
  it('falls back to the project cwd', () => {
    expect(resolveExecCwd(undefined, 'D:/projeto')).toBe('D:/projeto')
    expect(resolveExecCwd('   ', 'D:/projeto')).toBe('D:/projeto')
  })
  it('returns undefined when neither is set (process default)', () => {
    expect(resolveExecCwd(undefined, undefined)).toBeUndefined()
    expect(resolveExecCwd('', '  ')).toBeUndefined()
    expect(resolveExecCwd(123 as unknown as string, null)).toBeUndefined()
  })
})
