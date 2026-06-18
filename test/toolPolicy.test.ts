import { describe, it, expect } from 'vitest'
import { toolNeedsApproval, truncateToolOutput, isToolError, TOOL_OUTPUT_LIMIT } from '../src/utils/toolPolicy'

describe('toolNeedsApproval', () => {
  it('gates every dangerous tool in ask and planning', () => {
    for (const level of ['ask', 'planning'] as const) {
      expect(toolNeedsApproval(level, 'execute_command')).toBe(true)
      expect(toolNeedsApproval(level, 'write_file')).toBe(true)
      expect(toolNeedsApproval(level, 'git_command')).toBe(true)
      expect(toolNeedsApproval(level, 'browser_navigate')).toBe(true)
    }
  })

  it('lets edit tools through in auto_edits but still gates the rest', () => {
    expect(toolNeedsApproval('auto_edits', 'write_file')).toBe(false)
    expect(toolNeedsApproval('auto_edits', 'git_command')).toBe(false)
    expect(toolNeedsApproval('auto_edits', 'execute_command')).toBe(true) // not an edit tool
    expect(toolNeedsApproval('auto_edits', 'browser_navigate')).toBe(true)
  })

  it('never asks in ignore mode', () => {
    expect(toolNeedsApproval('ignore', 'execute_command')).toBe(false)
    expect(toolNeedsApproval('ignore', 'write_file')).toBe(false)
  })

  it('never asks for safe (non-dangerous) tools at any level', () => {
    for (const level of ['ask', 'auto_edits', 'planning', 'ignore'] as const) {
      expect(toolNeedsApproval(level, 'read_file')).toBe(false)
      expect(toolNeedsApproval(level, 'web_search')).toBe(false)
      expect(toolNeedsApproval(level, 'undo_last_write')).toBe(false)
    }
  })
})

describe('isToolError (audit/telemetry classification)', () => {
  it('catches the legacy prefixes', () => {
    expect(isToolError('Erro: arquivo não encontrado')).toBe(true)
    expect(isToolError('Erro ao listar diretorio')).toBe(true)
    expect(isToolError('[SYSTEM INTERCEPT]: Circuit Breaker Triggered')).toBe(true)
  })

  it('catches the labeled prefixes that were previously logged as SUCCESS', () => {
    expect(isToolError('Git error: not a repository')).toBe(true)
    expect(isToolError('Browser launch error: spawn failed')).toBe(true)
    expect(isToolError('Navigation error: timeout')).toBe(true)
    expect(isToolError('Screenshot error: no window')).toBe(true)
    expect(isToolError('Key press error: x')).toBe(true)
    expect(isToolError('Error: generic')).toBe(true)
  })

  it('catches failed execute_command via the exit-code/timeout markers (tool-scoped)', () => {
    expect(isToolError('npm ERR!\n[exit code: 1]', 'execute_command')).toBe(true)
    expect(isToolError('parcial…\n[processo encerrado: tempo limite excedido]', 'execute_command')).toBe(true)
    // same text from another tool (e.g. read_file on an old log) is NOT an error
    expect(isToolError('log antigo:\n[exit code: 1]', 'read_file')).toBe(false)
  })

  it('catches the PT failure prefixes from the fused tools (glob/background)', () => {
    expect(isToolError('Não consegui varrer "D:\\proj": acesso negado')).toBe(true)
    expect(isToolError('Não consegui iniciar o comando em background: pasta inexistente.')).toBe(true)
    expect(isToolError('Falha ao conectar')).toBe(true)
    expect(isToolError('Falhou a verificação')).toBe(true)
    expect(isToolError('Falhei ao abrir o arquivo')).toBe(true)
  })

  it('does NOT flag legitimate no-match / empty results as errors', () => {
    // "Nenhum …"/"Nada encontrado …" são no-match válidos, não falhas
    expect(isToolError('Nenhum arquivo casa "**/*.xyz" em D:\\proj (…).')).toBe(false)
    expect(isToolError('Nenhum comando em background com id "bg9" — ele já terminou…')).toBe(false)
    expect(isToolError('Nada encontrado nas conversas anteriores sobre "x".')).toBe(false)
  })

  it('treats normal output as success — including text that mentions errors', () => {
    expect(isToolError('Arquivo escrito com sucesso')).toBe(false)
    expect(isToolError('build ok', 'execute_command')).toBe(false)
    expect(isToolError('O log contém "Git error:" na linha 40')).toBe(false)
    expect(isToolError('')).toBe(false)
  })
})

describe('truncateToolOutput', () => {
  it('passes short / empty output through unchanged', () => {
    expect(truncateToolOutput('hello')).toBe('hello')
    expect(truncateToolOutput('')).toBe('')
  })

  it('passes output exactly at the limit through unchanged', () => {
    const s = 'x'.repeat(TOOL_OUTPUT_LIMIT)
    expect(truncateToolOutput(s)).toBe(s)
  })

  it('truncates over-limit output, keeping head + tail with a marker', () => {
    const s = 'A'.repeat(2000) + 'M'.repeat(2000) + 'Z'.repeat(2000) // 6000
    const out = truncateToolOutput(s)
    expect(out.length).toBeLessThan(s.length)
    expect(out).toContain('SYSTEM TRUNCATED')
    expect(out).toContain('6000 characters')
    expect(out.startsWith('A')).toBe(true)
    expect(out.endsWith('Z')).toBe(true)
  })
})
