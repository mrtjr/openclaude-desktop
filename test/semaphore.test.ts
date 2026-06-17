import { describe, it, expect } from 'vitest'
import { Semaphore } from '../src/utils/semaphore'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('Semaphore', () => {
  it('nunca roda mais que o limite ao mesmo tempo', async () => {
    const sem = new Semaphore(2)
    let active = 0, peak = 0
    const task = () => sem.run(async () => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    await Promise.all(Array.from({ length: 7 }, task))
    expect(peak).toBe(2)
  })

  it('reporta running e waiting; a 3ª espera com limite 2', async () => {
    const sem = new Semaphore(2)
    const a = deferred(), b = deferred(), c = deferred()
    const p1 = sem.run(() => a.promise)
    const p2 = sem.run(() => b.promise)
    const p3 = sem.run(() => c.promise)
    await Promise.resolve() // deixa as aquisições síncronas assentarem
    expect(sem.running).toBe(2)
    expect(sem.waiting).toBe(1)
    a.resolve(); await p1
    expect(sem.running).toBe(2) // a 3ª assumiu a vaga
    expect(sem.waiting).toBe(0)
    b.resolve(); c.resolve(); await Promise.all([p2, p3])
    expect(sem.running).toBe(0)
  })

  it('aquisição é síncrona até o limite (admissão confiável)', () => {
    const sem = new Semaphore(2)
    sem.run(() => new Promise(() => {})) // nunca resolve
    sem.run(() => new Promise(() => {}))
    expect(sem.running).toBe(2) // já contabilizado sincronicamente
    sem.run(() => new Promise(() => {}))
    expect(sem.waiting).toBe(1)
  })

  it('setMax maior libera os que estavam na fila', async () => {
    const sem = new Semaphore(1)
    const a = deferred(), b = deferred()
    sem.run(() => a.promise)
    sem.run(() => b.promise)
    await Promise.resolve()
    expect(sem.running).toBe(1)
    expect(sem.waiting).toBe(1)
    sem.setMax(2)
    expect(sem.running).toBe(2)
    expect(sem.waiting).toBe(0)
    a.resolve(); b.resolve()
  })

  it('libera a vaga mesmo se fn lança', async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(sem.running).toBe(0) // vaga devolvida
  })
})
