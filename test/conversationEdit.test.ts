import { describe, it, expect } from 'vitest'
import { sliceBeforeMessage, canEditMessage, classifyEdit } from '../src/utils/conversationEdit'
import type { Message } from '../src/types'

let seq = 0
function msg(over: Partial<Message> = {}): Message {
  return {
    id: `m${++seq}`,
    role: 'user',
    content: 'oi',
    timestamp: new Date('2026-01-01T12:00:00'),
    ...over,
  }
}

describe('sliceBeforeMessage', () => {
  it('returns everything strictly before the target message', () => {
    const u1 = msg({ id: 'u1', content: 'primeira' })
    const a1 = msg({ id: 'a1', role: 'assistant', content: 'resposta' })
    const u2 = msg({ id: 'u2', content: 'segunda' })
    const a2 = msg({ id: 'a2', role: 'assistant', content: 'resposta 2' })
    const out = sliceBeforeMessage([u1, a1, u2, a2], 'u2')
    expect(out).toEqual([u1, a1])
  })

  it('returns an empty prefix when editing the very first message', () => {
    const u1 = msg({ id: 'u1' })
    const a1 = msg({ id: 'a1', role: 'assistant' })
    expect(sliceBeforeMessage([u1, a1], 'u1')).toEqual([])
  })

  it('returns null when the id is not present', () => {
    expect(sliceBeforeMessage([msg({ id: 'u1' })], 'nope')).toBeNull()
  })

  it('does not mutate the input array', () => {
    const arr = [msg({ id: 'u1' }), msg({ id: 'u2' })]
    const copy = [...arr]
    sliceBeforeMessage(arr, 'u2')
    expect(arr).toEqual(copy)
  })
})

describe('canEditMessage', () => {
  it('allows non-empty user messages only', () => {
    expect(canEditMessage(msg({ role: 'user', content: 'oi' }))).toBe(true)
    expect(canEditMessage(msg({ role: 'user', content: '   ' }))).toBe(false)
    expect(canEditMessage(msg({ role: 'assistant', content: 'oi' }))).toBe(false)
    expect(canEditMessage(msg({ role: 'tool', content: 'oi' }))).toBe(false)
  })
})

describe('classifyEdit', () => {
  it('resends trimmed text when it differs from the original', () => {
    expect(classifyEdit('antiga', '  nova  ')).toEqual({ action: 'resend', text: 'nova' })
  })

  it('treats whitespace-only changes as a noop', () => {
    expect(classifyEdit('mesma', '  mesma  ')).toEqual({ action: 'noop', text: 'mesma' })
  })

  it('treats a cleared field as empty (cancel)', () => {
    expect(classifyEdit('algo', '   ')).toEqual({ action: 'empty', text: '' })
  })
})
