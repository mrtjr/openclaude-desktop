import { describe, it, expect } from 'vitest'
import { formatDroppedFile, DROPPED_FILE_MAX_CHARS } from '../src/utils/attachments'

describe('formatDroppedFile', () => {
  it('wraps the content in a fenced block with the file name', () => {
    const out = formatDroppedFile('relatorio.csv', 'a;b;c\n1;2;3')
    expect(out).toContain('[Arquivo: relatorio.csv]')
    expect(out).toContain('```\na;b;c\n1;2;3\n```')
    expect(out).not.toContain('TRUNCADO')
  })

  it('passes content exactly at the limit through without a marker', () => {
    const out = formatDroppedFile('x.log', 'x'.repeat(DROPPED_FILE_MAX_CHARS))
    expect(out).not.toContain('TRUNCADO')
  })

  it('clips over-limit content WITH an explicit marker (no more silent loss)', () => {
    const content = 'y'.repeat(DROPPED_FILE_MAX_CHARS + 5000)
    const out = formatDroppedFile('mt5.log', content)
    expect(out).toContain(`[TRUNCADO: mostrando ${DROPPED_FILE_MAX_CHARS} de ${content.length} caracteres do arquivo]`)
    // body really is clipped
    expect(out.length).toBeLessThan(content.length)
  })

  it('respects a custom max', () => {
    const out = formatDroppedFile('a.txt', 'abcdef', 3)
    expect(out).toContain('abc')
    expect(out).toContain('[TRUNCADO: mostrando 3 de 6 caracteres do arquivo]')
    expect(out).not.toContain('abcd')
  })

  it('usa cerca mais longa quando o arquivo contém ``` (v2.181.0)', () => {
    const md = 'Veja:\n```js\nconsole.log(1)\n```\nfim'
    const out = formatDroppedFile('README.md', md)
    expect(out).toContain('````\n' + md + '\n````') // cerca de 4 crases envolve o conteúdo com 3
    expect(out).toContain(md)                        // conteúdo preservado intacto
  })
})
