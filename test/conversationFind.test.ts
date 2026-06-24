import { describe, it, expect } from 'vitest'
import { findMessageMatches, countOccurrences, totalOccurrences, stepHitIndex } from '../src/utils/conversationFind'
import type { Message } from '../src/types'

let seq = 0
function msg(over: Partial<Message> = {}): Message {
  return { id: `m${++seq}`, role: 'user', content: '', timestamp: new Date('2026-01-01T12:00:00'), ...over }
}

describe('countOccurrences', () => {
  it('counts non-overlapping, case-insensitive', () => {
    expect(countOccurrences('Olá olá OLÁ', 'olá')).toBe(3)
    expect(countOccurrences('aaaa', 'aa')).toBe(2)
    expect(countOccurrences('nada aqui', 'xyz')).toBe(0)
    expect(countOccurrences('texto', '')).toBe(0)
  })
})

describe('findMessageMatches', () => {
  it('returns matching searchable messages in order, with counts', () => {
    const a = msg({ id: 'a', content: 'fala de gato e gato' })
    const b = msg({ id: 'b', role: 'assistant', content: 'cachorro' })
    const c = msg({ id: 'c', role: 'assistant', content: 'outro gato' })
    const hits = findMessageMatches([a, b, c], 'gato')
    expect(hits).toEqual([{ id: 'a', count: 2 }, { id: 'c', count: 1 }])
  })

  it('ignores hidden turns and assistant tool-step messages', () => {
    const hidden = msg({ id: 'h', content: 'gato', hidden: true })
    const toolStep = msg({ id: 't', role: 'assistant', content: 'gato', toolCalls: [{ id: 'x', name: 'run', arguments: {} }] })
    const real = msg({ id: 'r', content: 'gato' })
    expect(findMessageMatches([hidden, toolStep, real], 'gato')).toEqual([{ id: 'r', count: 1 }])
  })

  it('requires at least 2 chars to avoid matching everything', () => {
    expect(findMessageMatches([msg({ content: 'aaa' })], 'a')).toEqual([])
    expect(findMessageMatches([msg({ content: 'aaa' })], '  ')).toEqual([])
  })
})

describe('totalOccurrences', () => {
  it('sums occurrence counts across hits', () => {
    expect(totalOccurrences([{ id: 'a', count: 2 }, { id: 'b', count: 3 }])).toBe(5)
    expect(totalOccurrences([])).toBe(0)
  })
})

describe('stepHitIndex', () => {
  it('wraps around in both directions', () => {
    expect(stepHitIndex(0, 3, 1)).toBe(1)
    expect(stepHitIndex(2, 3, 1)).toBe(0)
    expect(stepHitIndex(0, 3, -1)).toBe(2)
    expect(stepHitIndex(0, 0, 1)).toBe(0)
  })
})
