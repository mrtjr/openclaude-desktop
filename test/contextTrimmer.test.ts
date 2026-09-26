import { describe, it, expect } from 'vitest'
import { trimContextWindow } from '../src/utils/contextTrimmer'

type M = { role: string; content: string; tool_calls?: unknown; tool_call_id?: string }
const sys = (c: string): M => ({ role: 'system', content: c })
const user = (c: string, n = 0): M => ({ role: 'user', content: c + 'x'.repeat(n) })
const asst = (c: string, n = 0): M => ({ role: 'assistant', content: c + 'x'.repeat(n) })
const call = (id: string): M => ({ role: 'assistant', content: '', tool_calls: [{ id, function: { name: 'read_file', arguments: '{}' } }] })
const tool = (id: string, n = 0): M => ({ role: 'tool', tool_call_id: id, content: 'r' + 'x'.repeat(n) })

/** Toda `tool` mantida tem de vir logo depois (pulando system) de um assistant
 *  com tool_calls ou de outra `tool` do mesmo grupo — senão é HTTP 400. */
function noOrphanTools(list: M[]): boolean {
  return list.every((m, i) => {
    if (m.role !== 'tool') return true
    let j = i - 1
    while (j >= 0 && list[j].role === 'system') j--
    return j >= 0 && (list[j].role === 'tool' || (list[j].role === 'assistant' && !!list[j].tool_calls))
  })
}

// Histórico agêntico longo: 2 turnos antigos pesados + o turno atual com 2 trocas.
const history = (): M[] => [
  sys('PROMPT'),
  user('antigo-1', 40000), asst('resp-1', 40000),
  user('antigo-2', 40000), call('a'), tool('a', 40000), asst('resp-2'),
  user('TAREFA'), call('b'), tool('b', 40000), call('c'), tool('c', 4000),
  sys('MEMORIA'), sys('IDIOMA'),
]

describe('trimContextWindow — corte por custo sem quebrar a requisição', () => {
  it('não mexe em conversa curta nem abaixo do teto (mesma referência)', () => {
    const short = [sys('a'), user('b'), asst('c')]
    expect(trimContextWindow(short, 10)).toBe(short)
    const small = history().map((m) => ({ ...m, content: m.content.slice(0, 20) }))
    expect(trimContextWindow(small, 80000)).toBe(small)
  })

  it('mantém TODAS as mensagens system e a tarefa atual do usuário', () => {
    const out = trimContextWindow(history(), 20000)
    for (const c of ['PROMPT', 'MEMORIA', 'IDIOMA']) expect(out.some((m) => m.role === 'system' && m.content === c)).toBe(true)
    expect(out.some((m) => m.role === 'user' && m.content === 'TAREFA')).toBe(true)
  })

  it('corta do mais antigo e avisa quantas saíram, logo após os system iniciais', () => {
    const src = history()
    const out = trimContextWindow(src, 20000)
    expect(out.some((m) => m.content.startsWith('antigo-1'))).toBe(false)
    expect(out[1].role).toBe('system')
    expect(out[1].content).toContain('<context_compressed>')
    const removed = src.length - (out.length - 1)
    expect(out[1].content).toContain(`${removed} mensagens`)
  })

  it('nunca deixa `tool` órfã e o histórico abre com o usuário', () => {
    for (const budget of [1000, 20000, 50000, 90000, 130000]) {
      const out = trimContextWindow(history(), budget)
      expect(noOrphanTools(out), `budget ${budget}`).toBe(true)
      expect(out.find((m) => m.role !== 'system')?.role, `budget ${budget}`).toBe('user')
    }
  })

  it('a troca mais recente do turno fica mesmo sozinha acima do teto', () => {
    const src = [sys('P'), user('u0'), asst('a0'), user('u1'), asst('a1'), user('TAREFA'), call('z'), tool('z', 100000)]
    const out = trimContextWindow(src, 1000)
    expect(out.some((m) => m.role === 'tool' && m.tool_call_id === 'z')).toBe(true)
    expect(out.some((m) => m.role === 'assistant' && !!m.tool_calls)).toBe(true)
    expect(noOrphanTools(out)).toBe(true)
  })
})
