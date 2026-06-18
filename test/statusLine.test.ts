import { describe, it, expect } from 'vitest'
import { basename, statusItemValue, buildStatusSegments, buildStatusLineText } from '../src/utils/statusLine'

describe('basename', () => {
  it('pega o último segmento de caminhos win/posix', () => {
    expect(basename('D:\\proj\\app')).toBe('app')
    expect(basename('/home/u/code/')).toBe('code')
    expect(basename('')).toBe('')
  })
})

describe('statusItemValue', () => {
  it('formata contexto como % arredondado', () => {
    expect(statusItemValue('context', { contextPct: 23.6 })).toBe('24%')
    expect(statusItemValue('context', {})).toBe('')
  })
  it('cwd vira basename; vazios viram ""', () => {
    expect(statusItemValue('cwd', { cwd: 'C:\\x\\meuapp' })).toBe('meuapp')
    expect(statusItemValue('model', {})).toBe('')
  })
})

describe('buildStatusSegments', () => {
  const data = { model: 'opus', provider: 'modal', branch: 'main', cwd: '/a/proj', persona: 'Dev', contextPct: 50 }
  it('só os itens habilitados e com valor, na ordem canônica', () => {
    const segs = buildStatusSegments(['context', 'model', 'branch'], data, 'pt')
    expect(segs.map(s => s.key)).toEqual(['model', 'branch', 'context']) // ordem canônica
    expect(segs.find(s => s.key === 'context')!.value).toBe('50%')
  })
  it('pula itens sem valor', () => {
    const segs = buildStatusSegments(['model', 'branch'], { model: 'opus' }, 'pt')
    expect(segs.map(s => s.key)).toEqual(['model'])
  })
  it('rótulos PT/EN', () => {
    expect(buildStatusSegments(['cwd'], data, 'en')[0].label).toBe('folder')
    expect(buildStatusSegments(['cwd'], data, 'pt')[0].label).toBe('pasta')
  })
  it('lista vazia → nenhum segmento', () => {
    expect(buildStatusSegments([], data, 'pt')).toEqual([])
    expect(buildStatusSegments(undefined, data, 'pt')).toEqual([])
  })
})

describe('buildStatusLineText', () => {
  it('junta os valores com " · "', () => {
    expect(buildStatusLineText(['model', 'cwd', 'context'], { model: 'opus', cwd: '/a/proj', contextPct: 12 }, 'pt'))
      .toBe('opus · proj · 12%')
  })
})
