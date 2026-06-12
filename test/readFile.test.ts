import { describe, it, expect } from 'vitest'
import { paginateFileContent } from '../src/utils/readFile'

const FILE = Array.from({ length: 10 }, (_, i) => `linha ${i + 1}`).join('\n')

describe('paginateFileContent', () => {
  it('returns content UNCHANGED when neither offset nor limit is given (zero regression)', () => {
    expect(paginateFileContent(FILE)).toBe(FILE)
    expect(paginateFileContent(FILE, undefined, undefined)).toBe(FILE)
    expect(paginateFileContent(FILE, null as any, '')).toBe(FILE)
    expect(paginateFileContent('')).toBe('')
  })

  it('slices a line window and reports range/total + how to continue', () => {
    const out = paginateFileContent(FILE, 3, 4)
    expect(out).toBe('[linhas 3–6 de 10 — continue com offset=7]\nlinha 3\nlinha 4\nlinha 5\nlinha 6')
  })

  it('limit alone reads from the top', () => {
    const out = paginateFileContent(FILE, undefined, 2)
    expect(out).toBe('[linhas 1–2 de 10 — continue com offset=3]\nlinha 1\nlinha 2')
  })

  it('offset alone reads to the end (no "continue" hint)', () => {
    const out = paginateFileContent(FILE, 8)
    expect(out).toBe('[linhas 8–10 de 10]\nlinha 8\nlinha 9\nlinha 10')
  })

  it('clamps a window past the end and omits the continue hint', () => {
    const out = paginateFileContent(FILE, 9, 50)
    expect(out).toBe('[linhas 9–10 de 10]\nlinha 9\nlinha 10')
  })

  it('reports clearly when offset is beyond EOF', () => {
    expect(paginateFileContent(FILE, 99)).toBe('[arquivo tem 10 linhas; offset 99 está além do fim]')
  })

  it('tolerates string-typed numeric args (models often send strings)', () => {
    expect(paginateFileContent(FILE, '2', '2')).toBe('[linhas 2–3 de 10 — continue com offset=4]\nlinha 2\nlinha 3')
  })
})
