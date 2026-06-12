import { describe, it, expect } from 'vitest'
import { parseSearchGlob, formatSearchResults } from '../src/utils/searchFiles'

describe('parseSearchGlob', () => {
  it('returns null when there is no filter', () => {
    expect(parseSearchGlob(undefined)).toBeNull()
    expect(parseSearchGlob('')).toBeNull()
    expect(parseSearchGlob('   ')).toBeNull()
    expect(parseSearchGlob(42 as any)).toBeNull()
  })
  it('parses the common glob forms into dotted extensions', () => {
    expect(parseSearchGlob('*.ts')).toEqual(['.ts'])
    expect(parseSearchGlob('ts')).toEqual(['.ts'])
    expect(parseSearchGlob('ts,tsx')).toEqual(['.ts', '.tsx'])
    expect(parseSearchGlob('*.{ts,tsx}')).toEqual(['.ts', '.tsx'])
    expect(parseSearchGlob('.JS')).toEqual(['.js']) // lowercased, single leading dot
  })
})

describe('formatSearchResults', () => {
  it('renders matches as path:line: text', () => {
    const out = formatSearchResults({
      matches: [
        { file: 'D:/p/a.ts', line: 12, text: 'export function foo()' },
        { file: 'D:/p/b.ts', line: 3, text: 'foo()' },
      ],
    }, 'foo')
    expect(out).toBe('D:/p/a.ts:12: export function foo()\nD:/p/b.ts:3: foo()')
  })

  it('reports no matches (with files-scanned when present)', () => {
    expect(formatSearchResults({ matches: [], filesScanned: 40 }, 'bar')).toContain('Nenhuma ocorrência de "bar"')
    expect(formatSearchResults({ matches: [], filesScanned: 40 }, 'bar')).toContain('40 arquivos')
  })

  it('appends a truncation note', () => {
    const out = formatSearchResults({ matches: [{ file: 'a', line: 1, text: 'x' }], truncated: true }, 'x')
    expect(out).toContain('[truncado:')
    expect(out).toContain('refine a busca')
  })

  it('surfaces errors', () => {
    expect(formatSearchResults({ error: 'Access denied' }, 'x')).toBe('Erro na busca: Access denied')
  })
})
