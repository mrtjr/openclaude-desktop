import { describe, it, expect } from 'vitest'
import { formatEditResult, formatWriteResult, COACH_REWRITE_MIN_CHARS } from '../src/utils/editResult'
import { isToolError } from '../src/utils/toolPolicy'
import { AGENT_SYSTEM_PROMPT } from '../src/constants/prompts'

describe('formatWriteResult — coaching de edit_file (v2.19.0)', () => {
  it('reescrita grande de arquivo EXISTENTE ganha a nota de coaching', () => {
    const out = formatWriteResult({ error: null, existed: true }, 'a.ts', COACH_REWRITE_MIN_CHARS)
    expect(out).toContain('sucesso')
    expect(out).toContain('edit_file')
    expect(isToolError(out)).toBe(false)
  })

  it('arquivo NOVO não ganha coaching, qualquer tamanho', () => {
    expect(formatWriteResult({ error: null, existed: false }, 'a.ts', 50_000)).toBe('Arquivo escrito com sucesso')
  })

  it('reescrita pequena de existente não ganha coaching (config curto é ok)', () => {
    expect(formatWriteResult({ error: null, existed: true }, 'a.ts', COACH_REWRITE_MIN_CHARS - 1)).toBe('Arquivo escrito com sucesso')
  })

  it('erro continua erro', () => {
    const out = formatWriteResult({ error: 'EACCES' }, 'a.ts', 10)
    expect(out).toBe('Erro: EACCES')
    expect(isToolError(out)).toBe(true)
  })
})

describe('AGENT_SYSTEM_PROMPT — steering de edit_file', () => {
  it('pt e en instruem editar em vez de reescrever', () => {
    expect(AGENT_SYSTEM_PROMPT.pt).toContain('edit_file')
    expect(AGENT_SYSTEM_PROMPT.pt).toMatch(/EDITE, NÃO REESCREVA/)
    expect(AGENT_SYSTEM_PROMPT.en).toContain('edit_file')
    expect(AGENT_SYSTEM_PROMPT.en).toMatch(/EDIT, DON'T REWRITE/)
  })
})

describe('formatEditResult', () => {
  it('reports success with the path', () => {
    const out = formatEditResult({ error: null, replaced: true, occurrences: 1 }, 'D:/robos/ea.mq5')
    expect(out).toBe('Arquivo editado: D:/robos/ea.mq5')
    expect(isToolError(out)).toBe(false)
  })

  it('replace_all: reporta a contagem de ocorrências substituídas (v2.82.0)', () => {
    const out = formatEditResult({ error: null, replaced: true, occurrences: 5 }, 'a.ts')
    expect(out).toBe('Arquivo editado: a.ts (5 ocorrências substituídas)')
    expect(isToolError(out)).toBe(false)
  })

  it('gives an actionable message when the snippet is not found', () => {
    const out = formatEditResult({ error: 'not_found', occurrences: 0 }, 'a.ts')
    expect(out).toContain('não foi encontrado')
    expect(isToolError(out)).toBe(true)
  })

  it('explains ambiguity with the occurrence count', () => {
    const out = formatEditResult({ error: 'ambiguous', occurrences: 3 }, 'a.ts')
    expect(out).toContain('3×')
    expect(out).toContain('ÚNICO')
    expect(isToolError(out)).toBe(true)
  })

  it('steers to write_file when the file is missing', () => {
    const out = formatEditResult({ error: 'file_not_found' }, 'novo.ts')
    expect(out).toContain('não existe')
    expect(out).toContain('write_file')
  })

  it('handles empty old_string and unknown errors', () => {
    expect(formatEditResult({ error: 'empty_old_string' }, 'a.ts')).toContain('old_string está vazio')
    expect(formatEditResult({ error: 'EACCES' }, 'a.ts')).toContain('EACCES')
  })
})
