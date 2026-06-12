import { describe, it, expect } from 'vitest'
import { groupMessages, isToolStep, summarizeSteps } from '../src/utils/messageGroups'
import type { Message } from '../src/types'

let seq = 0
function msg(over: Partial<Message> = {}): Message {
  return {
    id: `m${++seq}`,
    role: 'assistant',
    content: '',
    timestamp: new Date('2026-01-01T12:00:00'),
    ...over,
  }
}
function toolStep(over: Partial<Message> = {}): Message {
  return msg({
    toolCalls: [{ id: 'tc1', name: 'execute_command', arguments: { command: 'ls' } }],
    toolResults: [{ toolCallId: 'tc1', name: 'execute_command', result: 'ok' }],
    ...over,
  })
}

describe('isToolStep', () => {
  it('true only for assistant messages with toolCalls', () => {
    expect(isToolStep(toolStep())).toBe(true)
    expect(isToolStep(msg({ role: 'user', content: 'oi' }))).toBe(false)
    expect(isToolStep(msg({ content: 'resposta final' }))).toBe(false)
    expect(isToolStep(msg({ toolCalls: [] }))).toBe(false)
  })
})

describe('groupMessages', () => {
  it('returns empty for no messages', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('groups consecutive tool steps and keeps the final answer standalone', () => {
    const user = msg({ role: 'user', content: 'faça X' })
    const s1 = toolStep(); const s2 = toolStep(); const s3 = toolStep()
    const answer = msg({ content: 'pronto!' })
    const items = groupMessages([user, s1, s2, s3, answer])
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({ kind: 'single', msg: user })
    expect(items[1]).toEqual({ kind: 'steps', key: s1.id, msgs: [s1, s2, s3] })
    expect(items[2]).toEqual({ kind: 'single', msg: answer })
  })

  it('a lone tool step stays a single message (run < minRun)', () => {
    const user = msg({ role: 'user', content: 'oi' })
    const s1 = toolStep()
    const answer = msg({ content: 'feito' })
    const items = groupMessages([user, s1, answer])
    expect(items.every(i => i.kind === 'single')).toBe(true)
    expect(items).toHaveLength(3)
  })

  it('separate runs produce separate groups (stable keys per first id)', () => {
    const a1 = toolStep(); const a2 = toolStep()
    const mid = msg({ content: 'parcial' })
    const b1 = toolStep(); const b2 = toolStep()
    const items = groupMessages([a1, a2, mid, b1, b2])
    expect(items.map(i => i.kind)).toEqual(['steps', 'single', 'steps'])
    expect((items[0] as any).key).toBe(a1.id)
    expect((items[2] as any).key).toBe(b1.id)
  })

  it('a trailing run (turn still streaming) is grouped too', () => {
    const user = msg({ role: 'user', content: 'vai' })
    const s1 = toolStep(); const s2 = toolStep()
    const items = groupMessages([user, s1, s2])
    expect(items[1]).toEqual({ kind: 'steps', key: s1.id, msgs: [s1, s2] })
  })
})

describe('summarizeSteps', () => {
  it('counts tools by name (desc) and flags errors via the provided classifier', () => {
    const s1 = toolStep()
    const s2 = toolStep({
      toolCalls: [{ id: 'tc2', name: 'web_search', arguments: { query: 'q' } }],
      toolResults: [{ toolCallId: 'tc2', name: 'web_search', result: 'Error: timeout' }],
    })
    const s3 = toolStep()
    const isError = (res: string) => res.startsWith('Error')
    const sum = summarizeSteps([s1, s2, s3], isError)
    expect(sum.total).toBe(3)
    expect(sum.counts).toEqual([['execute_command', 2], ['web_search', 1]])
    expect(sum.errors).toBe(1)
  })

  it('handles steps without results (in-flight) without counting errors', () => {
    const s = toolStep({ toolResults: undefined })
    const sum = summarizeSteps([s], () => true)
    expect(sum.total).toBe(1)
    expect(sum.errors).toBe(0)
  })
})
