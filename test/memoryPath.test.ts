import { describe, it, expect } from 'vitest'
import { resolveMemoryPath } from '../src/utils/memoryPath'

// memory_write roda SEM aprovação: o caminho não pode sair de .claude/memory.
describe('resolveMemoryPath', () => {
  it('aceita caminhos dentro da memória (barra inicial é opcional)', () => {
    expect(resolveMemoryPath('/perfil.md')).toEqual({ rel: 'perfil.md' })
    expect(resolveMemoryPath('logistica/rotas_ativas.md')).toEqual({ rel: 'logistica/rotas_ativas.md' })
    expect(resolveMemoryPath('./a/./b.md')).toEqual({ rel: 'a/b.md' })
  })

  it('recusa sair da pasta: .., drive, stream NTFS', () => {
    const BS = String.fromCharCode(92)
    for (const p of ['../../src/App.tsx', 'a/../../x', '..' + BS + 'x', 'C:/Windows/x.bat', 'perfil.md:oculto', '.../x']) {
      expect('error' in resolveMemoryPath(p), p).toBe(true)
    }
  })

  it('recusa caminho vazio', () => {
    for (const p of ['', '/', '  ', undefined]) expect('error' in resolveMemoryPath(p), String(p)).toBe(true)
  })
})
