import { describe, it, expect } from 'vitest'
import { estimateTokens, tokensPerSec, formatTokRate } from '../src/utils/streamRate'

describe('estimateTokens', () => {
  it('approximates ~4 chars per token, min 1 for non-empty', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(40))).toBe(10)
    expect(estimateTokens('ab')).toBe(1) // arredonda p/ baixo seria 0, mas piso é 1
  })
})

describe('tokensPerSec', () => {
  it('returns null before a reliable sample (<1s or no tokens)', () => {
    expect(tokensPerSec(100, 500)).toBeNull()
    expect(tokensPerSec(0, 5000)).toBeNull()
  })

  it('computes a rounded rate once there is a window', () => {
    expect(tokensPerSec(100, 2000)).toBe(50)
    expect(tokensPerSec(30, 1000)).toBe(30)
  })

  it('guards against bad inputs', () => {
    expect(tokensPerSec(10, 0)).toBeNull()
  })
})

describe('formatTokRate', () => {
  it('formats a friendly label or empty string', () => {
    expect(formatTokRate(100, 2000)).toBe('≈ 50 tok/s')
    expect(formatTokRate(100, 500)).toBe('')
  })
})
