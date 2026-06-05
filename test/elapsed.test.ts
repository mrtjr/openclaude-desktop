import { describe, it, expect } from 'vitest'
import { formatElapsed } from '../src/utils/elapsed'

describe('formatElapsed', () => {
  it('shows bare seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(5)).toBe('5s')
    expect(formatElapsed(59)).toBe('59s')
  })

  it('switches to m + zero-padded s at one minute', () => {
    expect(formatElapsed(60)).toBe('1m 00s')
    expect(formatElapsed(75)).toBe('1m 15s')
    expect(formatElapsed(125)).toBe('2m 05s')
    expect(formatElapsed(629)).toBe('10m 29s') // ~the digest p95
  })

  it('floors fractional seconds', () => {
    expect(formatElapsed(3.9)).toBe('3s')
    expect(formatElapsed(61.4)).toBe('1m 01s')
  })

  it('guards against negative / NaN / garbage input', () => {
    expect(formatElapsed(-5)).toBe('0s')
    expect(formatElapsed(NaN)).toBe('0s')
    expect(formatElapsed(undefined as any)).toBe('0s')
    expect(formatElapsed('abc' as any)).toBe('0s')
  })
})
