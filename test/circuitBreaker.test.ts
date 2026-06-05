import { describe, it, expect } from 'vitest'
import { countRecentRepeats, CIRCUIT_WINDOW } from '../src/utils/circuitBreaker'

describe('countRecentRepeats', () => {
  it('counts occurrences within the window', () => {
    expect(countRecentRepeats(['a', 'b', 'a'], 'a')).toBe(2)
    expect(countRecentRepeats(['a', 'b', 'a'], 'b')).toBe(1)
    expect(countRecentRepeats([], 'a')).toBe(0)
  })

  it('trips on the 3rd consecutive identical call (count reaches 2 before it)', () => {
    // a, a → next identical attempt sees 2 prior → breaker (>=2) fires on 3rd
    expect(countRecentRepeats(['a', 'a'], 'a')).toBe(2)
    expect(countRecentRepeats(['a'], 'a')).toBe(1) // 2nd attempt: only 1 prior, no trip
  })

  it('ignores repeats that have fallen outside the window (no false positive on far reuse)', () => {
    // 'a' once, then a full window of other calls → 'a' is no longer in view
    const recent = ['a', ...Array.from({ length: CIRCUIT_WINDOW }, (_, i) => 'x' + i)]
    expect(countRecentRepeats(recent, 'a')).toBe(0)
  })

  it('respects a custom window', () => {
    expect(countRecentRepeats(['a', 'a', 'a'], 'a', 2)).toBe(2) // last 2 entries only
    expect(countRecentRepeats(['a', 'b', 'c'], 'a', 2)).toBe(0) // 'a' outside last 2
  })
})
