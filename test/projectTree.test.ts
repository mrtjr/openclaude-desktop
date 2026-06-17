import { describe, it, expect } from 'vitest'
import { renderTree, formatProjectTree, type TreeNode } from '../src/utils/projectTree'

const tree: TreeNode[] = [
  { name: 'src', type: 'dir', children: [
    { name: 'utils', type: 'dir', children: [
      { name: 'rag.ts', type: 'file' },
      { name: 'vision.ts', type: 'file' },
    ] },
    { name: 'App.tsx', type: 'file' },
  ] },
  { name: 'package.json', type: 'file' },
]

describe('renderTree', () => {
  it('indenta por profundidade, dirs com "/"', () => {
    const { text, count, truncated } = renderTree(tree)
    expect(count).toBe(6)
    expect(truncated).toBe(false)
    expect(text).toContain('src/')
    expect(text).toContain('  utils/')
    expect(text).toContain('    rag.ts')
    expect(text).toContain('package.json')
  })

  it('respeita o teto de entradas e sinaliza truncamento', () => {
    const big: TreeNode[] = Array.from({ length: 50 }, (_, i) => ({ name: `f${i}.ts`, type: 'file' as const }))
    const { count, truncated } = renderTree(big, 10)
    expect(count).toBe(10)
    expect(truncated).toBe(true)
  })

  it('tolera entrada malformada', () => {
    expect(() => renderTree(undefined)).not.toThrow()
    expect(renderTree([{ type: 'file' } as any]).count).toBe(0) // sem name → ignorado
  })
})

describe('formatProjectTree', () => {
  it('formata com cabeçalho e contagem', () => {
    const out = formatProjectTree({ tree }, 'D:/proj')
    expect(out).toContain('Estrutura de D:/proj')
    expect(out).toContain('6 itens')
    expect(out).toContain('rag.ts')
  })
  it('erro → mensagem acionável', () => {
    expect(formatProjectTree({ error: 'sem acesso' }, 'X')).toContain('sem acesso')
    expect(formatProjectTree(null, 'X').toLowerCase()).toContain('não consegui')
  })
  it('árvore vazia → aviso', () => {
    expect(formatProjectTree({ tree: [] }, 'X').toLowerCase()).toContain('vazio ou inacessível')
  })
  it('marca truncamento no cabeçalho e na cauda', () => {
    const big: TreeNode[] = Array.from({ length: 50 }, (_, i) => ({ name: `f${i}.ts`, type: 'file' as const }))
    const out = formatProjectTree({ tree: big }, 'X', 10)
    expect(out).toContain('10+ itens')
    expect(out.toLowerCase()).toContain('truncado')
  })
})
