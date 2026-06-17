import { describe, it, expect } from 'vitest'
import { compressOutput } from '../src/utils/outputCompression'

// filler: uma linha única e longa (sem espaço no fim) p/ passar de MIN_COMPRESS_CHARS
const big = (s: string) => s + '\n' + '#'.repeat(450)

describe('compressOutput', () => {
  it('não toca entradas pequenas', () => {
    const r = compressOutput('linha curta\noutra')
    expect(r.changed).toBe(false)
    expect(r.text).toBe('linha curta\noutra')
  })

  it('colapsa linhas idênticas consecutivas (≥3) quando economiza', () => {
    const warn = 'WARN: depreciado — use a nova API de configuração em vez da antiga'
    const input = big(['cabeçalho', warn, warn, warn, warn, 'fim'].join('\n'))
    const r = compressOutput(input)
    expect(r.changed).toBe(true)
    expect(r.text).toContain('×4 linhas idênticas')
    // só uma ocorrência literal da linha antes do marcador
    expect(r.text.match(/WARN: depreciado/g)!.length).toBe(1)
  })

  it('colapsa linhas quase-idênticas (mesmo esqueleto, run longo), mantém 1ª e última', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Baixando pacote ${i} de 10`)
    const r = compressOutput(big(lines.join('\n')))
    expect(r.changed).toBe(true)
    expect(r.text).toContain('Baixando pacote 0 de 10')   // primeira
    expect(r.text).toContain('Baixando pacote 9 de 10')   // última (estado final)
    expect(r.text).toContain('similares omitidas')
  })

  it('NÃO colapsa linhas com conteúdo diferente (esqueleto diferente)', () => {
    const lines = ['5 apples', '3 oranges', '7 bananas', '2 grapes', '9 plums', '1 kiwi', '4 pears', '8 figs']
    const r = compressOutput(big(lines.join('\n')))
    // esqueletos diferentes (frutas diferentes) → nada de "similares"
    expect(r.text).not.toContain('similares')
  })

  it('colapsa runs de linhas em branco', () => {
    const r = compressOutput(big('a\n\n\n\n\nb'))
    expect(r.changed).toBe(true)
    expect(r.text.startsWith('a\n\nb')).toBe(true)
    expect(r.text.includes('\n\n\n')).toBe(false)
  })

  it('devolve o original (changed=false) quando não há redundância', () => {
    const input = big('linhas\ntodas\nunicas\ne\ndiferentes\nsem\nredundancia\nalguma')
    const r = compressOutput(input)
    expect(r.changed).toBe(false)
    expect(r.text).toBe(input)
  })
})
