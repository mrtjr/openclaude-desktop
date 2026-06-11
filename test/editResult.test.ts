import { describe, it, expect } from 'vitest'
import { formatEditResult } from '../src/utils/editResult'
import { isToolError } from '../src/utils/toolPolicy'

describe('formatEditResult', () => {
  it('reports success with the path', () => {
    const out = formatEditResult({ error: null, replaced: true, occurrences: 1 }, 'D:/robos/ea.mq5')
    expect(out).toBe('Arquivo editado: D:/robos/ea.mq5')
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
