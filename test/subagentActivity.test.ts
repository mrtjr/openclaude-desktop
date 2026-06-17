import { describe, it, expect } from 'vitest'
import { SubagentActivityStore } from '../src/utils/subagentActivity'

describe('SubagentActivityStore', () => {
  it('start → working; progress atualiza passos/ferramenta; finish → done', () => {
    const s = new SubagentActivityStore()
    s.start('w1', 'pesquisar React', 'llama3.2', 1000)
    expect(s.getSnapshot()).toMatchObject([{ id: 'w1', status: 'working', steps: 0 }])
    s.progress('w1', 2, ['web_search', 'fetch_url'], 'fetch_url')
    expect(s.getSnapshot()[0]).toMatchObject({ steps: 2, lastTool: 'fetch_url', toolsUsed: ['web_search', 'fetch_url'] })
    s.finish('w1', 'React 20.2', 3, ['web_search', 'fetch_url'], 2000)
    expect(s.getSnapshot()[0]).toMatchObject({ status: 'done', result: 'React 20.2', endedAt: 2000 })
  })

  it('fail marca erro', () => {
    const s = new SubagentActivityStore()
    s.start('w1', 't', 'm', 0)
    s.fail('w1', '[timeout]', 5)
    expect(s.getSnapshot()[0]).toMatchObject({ status: 'error', result: '[timeout]' })
  })

  it('getSnapshot devolve a MESMA referência entre mutações (contrato do useSyncExternalStore)', () => {
    const s = new SubagentActivityStore()
    s.start('w1', 't', 'm', 0)
    const snap1 = s.getSnapshot()
    expect(s.getSnapshot()).toBe(snap1) // sem mutação → mesma ref
    s.progress('w1', 1, [], undefined)
    expect(s.getSnapshot()).not.toBe(snap1) // mutou → nova ref
  })

  it('subscribe é notificado e clear esvazia', () => {
    const s = new SubagentActivityStore()
    let hits = 0
    const unsub = s.subscribe(() => { hits++ })
    s.start('w1', 't', 'm', 0)
    s.clear()
    expect(hits).toBe(2)
    expect(s.getSnapshot()).toEqual([])
    unsub()
    s.start('w2', 't', 'm', 0)
    expect(hits).toBe(2) // não notifica após unsubscribe
  })

  it('clear sem nada não notifica', () => {
    const s = new SubagentActivityStore()
    let hits = 0
    s.subscribe(() => { hits++ })
    s.clear()
    expect(hits).toBe(0)
  })
})
