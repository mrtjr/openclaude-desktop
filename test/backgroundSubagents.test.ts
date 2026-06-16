import { describe, it, expect } from 'vitest'
import { BackgroundSubagentRegistry } from '../src/utils/backgroundSubagents'

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('BackgroundSubagentRegistry', () => {
  it('takeCompleted devolve só as concluídas e as remove; pendentes ficam', async () => {
    const reg = new BackgroundSubagentRegistry()
    reg.register('a', Promise.resolve('RA'))
    let resolveB: (s: string) => void = () => {}
    reg.register('b', new Promise<string>((r) => { resolveB = r }))
    await flush()
    expect(reg.pendingCount()).toBe(1)
    const done = reg.takeCompleted()
    expect(done.map((d) => d.result)).toEqual(['RA'])
    expect(reg.hasAny()).toBe(true) // b ainda pendente
    resolveB('RB'); await flush()
    expect(reg.takeCompleted().map((d) => d.result)).toEqual(['RB'])
    expect(reg.hasAny()).toBe(false)
  })

  it('drain aguarda as pendentes e devolve os resultados, esvaziando', async () => {
    const reg = new BackgroundSubagentRegistry()
    reg.register('a', new Promise<string>((r) => setTimeout(() => r('RA'), 5)))
    reg.register('b', Promise.resolve('RB'))
    const all = await reg.drain()
    expect(all.map((e) => e.result).sort()).toEqual(['RA', 'RB'])
    expect(reg.hasAny()).toBe(false)
  })

  it('uma Promise que rejeita vira string de erro (não derruba o drain)', async () => {
    const reg = new BackgroundSubagentRegistry()
    reg.register('a', Promise.reject(new Error('boom')))
    const all = await reg.drain()
    expect(all[0].result).toContain('boom')
  })

  it('gera ids únicos e clear esvazia tudo', () => {
    const reg = new BackgroundSubagentRegistry()
    const id1 = reg.register('a', Promise.resolve('1'))
    const id2 = reg.register('b', Promise.resolve('2'))
    expect(id1).not.toBe(id2)
    expect(reg.hasAny()).toBe(true)
    reg.clear()
    expect(reg.hasAny()).toBe(false)
    expect(reg.pendingCount()).toBe(0)
  })

  it('drain sem nada registrado é no-op', async () => {
    const reg = new BackgroundSubagentRegistry()
    expect(await reg.drain()).toEqual([])
  })
})
