import { describe, it, expect } from 'vitest'
import { globToRegExp, flattenTreeFiles, matchGlob, formatGlobResults } from '../src/utils/glob'
import type { TreeNode } from '../src/utils/projectTree'

describe('globToRegExp', () => {
  const m = (pat: string, path: string) => globToRegExp(pat).test(path)

  it('"*.ts" casa só a raiz (semântica padrão)', () => {
    expect(m('*.ts', 'a.ts')).toBe(true)
    expect(m('*.ts', 'src/a.ts')).toBe(false)
    expect(m('*.ts', 'a.tsx')).toBe(false)
  })

  it('"**/*.ts" casa recursivo', () => {
    expect(m('**/*.ts', 'a.ts')).toBe(true)
    expect(m('**/*.ts', 'src/a.ts')).toBe(true)
    expect(m('**/*.ts', 'src/x/y/a.ts')).toBe(true)
    expect(m('**/*.ts', 'a.tsx')).toBe(false)
  })

  it('prefixo + ** + alternância {a,b}', () => {
    expect(m('src/**/*.{ts,tsx}', 'src/a.ts')).toBe(true)
    expect(m('src/**/*.{ts,tsx}', 'src/x/b.tsx')).toBe(true)
    expect(m('src/**/*.{ts,tsx}', 'lib/a.ts')).toBe(false)
    expect(m('src/**/*.{ts,tsx}', 'src/a.js')).toBe(false)
  })

  it('? casa um caractere; case-insensitive', () => {
    expect(m('file?.txt', 'file1.txt')).toBe(true)
    expect(m('file?.txt', 'file12.txt')).toBe(false)
    expect(m('**/README.md', 'docs/readme.md')).toBe(true) // case-insensitive
  })

  it('escapa metacaracteres de regex literais', () => {
    expect(m('a.(b).ts', 'a.(b).ts')).toBe(true)
    expect(m('a.(b).ts', 'aX(b).ts')).toBe(false) // o "." é literal, não "qualquer"
  })
})

describe('flattenTreeFiles', () => {
  const tree: TreeNode[] = [
    { name: 'src', type: 'dir', children: [
      { name: 'a.ts', type: 'file' },
      { name: 'sub', type: 'dir', children: [{ name: 'b.tsx', type: 'file' }] },
    ] },
    { name: 'package.json', type: 'file' },
  ]
  it('achata só arquivos, caminho relativo com "/"', () => {
    expect(flattenTreeFiles(tree).sort()).toEqual(['package.json', 'src/a.ts', 'src/sub/b.tsx'])
  })
  it('tolera entrada vazia/malformada', () => {
    expect(flattenTreeFiles(undefined)).toEqual([])
    expect(flattenTreeFiles([{ type: 'file' } as any])).toEqual([])
  })
})

describe('matchGlob + formatGlobResults', () => {
  const tree: TreeNode[] = [
    { name: 'src', type: 'dir', children: [
      { name: 'a.ts', type: 'file' }, { name: 'a.test.ts', type: 'file' },
    ] },
  ]
  it('matchGlob filtra pela regra', () => {
    expect(matchGlob(['src/a.ts', 'src/a.test.ts', 'src/a.js'], '**/*.test.ts')).toEqual(['src/a.test.ts'])
  })
  it('formata achados ordenados', () => {
    const out = formatGlobResults({ tree }, '**/*.ts', 'D:/p')
    expect(out).toContain('2 arquivo(s) casando "**/*.ts"')
    expect(out).toContain('src/a.test.ts')
    expect(out).toContain('src/a.ts')
  })
  it('sem match → mensagem com dica de "**/"', () => {
    expect(formatGlobResults({ tree }, '*.py', 'D:/p')).toContain('Nenhum arquivo casa')
  })
  it('erro de varredura → mensagem', () => {
    expect(formatGlobResults({ error: 'sem acesso' }, '*', 'X')).toContain('sem acesso')
  })
})
