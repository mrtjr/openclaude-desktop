import { describe, it, expect } from 'vitest'
import { countRecentRepeats, CIRCUIT_WINDOW, isProgressResult, computeAgentProgress } from '../src/utils/circuitBreaker'

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

describe('isProgressResult', () => {
  it('treats a normal tool result as progress', () => {
    expect(isProgressResult({ name: 'web_search', result: 'Resultados...' })).toBe(true)
    expect(isProgressResult({ name: 'execute_command', result: 'OK' })).toBe(true)
  })
  it('does NOT count working-memory writes as progress', () => {
    expect(isProgressResult({ name: 'update_working_memory', result: '[SYSTEM]: ok' })).toBe(false)
  })
  it('does NOT count [SYSTEM INTERCEPT] guards (JSON error / circuit breaker) as progress', () => {
    expect(isProgressResult({ name: 'web_search', result: '[SYSTEM INTERCEPT]: Circuit Breaker Triggered...' })).toBe(false)
    expect(isProgressResult({ name: 'x', result: '[SYSTEM INTERCEPT]: JSON Parse Error...' })).toBe(false)
  })
  it('handles a missing result string', () => {
    expect(isProgressResult({ name: 'x', result: undefined as any })).toBe(true)
  })

  // ── Failed commands (v2.12.48, builds on the v2.12.47 exit-code markers) ──
  it('does NOT count a failed execute_command as progress', () => {
    expect(isProgressResult({
      name: 'execute_command',
      result: 'npm ERR! missing script: biuld\n[exit code: 1]',
    })).toBe(false)
    expect(isProgressResult({
      name: 'execute_command',
      result: '--- stderr ---\ncomando não reconhecido\n[exit code: 127]',
    })).toBe(false)
  })
  it('does NOT count a timed-out execute_command as progress', () => {
    expect(isProgressResult({
      name: 'execute_command',
      result: 'saída parcial…\n[processo encerrado: tempo limite excedido]',
    })).toBe(false)
  })
  it('still matches the timeout marker when the timeout_s hint line follows it (v2.12.50)', () => {
    expect(isProgressResult({
      name: 'execute_command',
      result: 'saída parcial…\n[processo encerrado: tempo limite excedido]\nDica: o comando excedeu 60s — chame de novo com timeout_s maior (máximo 600s).',
    })).toBe(false)
  })
  it('counts a successful execute_command as progress even when output MENTIONS an exit code', () => {
    // not line-anchored → not the marker
    expect(isProgressResult({
      name: 'execute_command',
      result: 'last run ended with [exit code: 3] according to the log',
    })).toBe(true)
    expect(isProgressResult({ name: 'execute_command', result: 'build ok' })).toBe(true)
  })
  it('ignores the marker text when it comes from ANOTHER tool (e.g. read_file on a saved log)', () => {
    expect(isProgressResult({
      name: 'read_file',
      result: 'log antigo:\n[exit code: 1]',
    })).toBe(true)
  })
})

describe('computeAgentProgress', () => {
  it('resets idle to 0 when a step makes real progress', () => {
    const r = computeAgentProgress([{ name: 'web_search', result: 'hits' }], 3, 5)
    expect(r).toEqual({ idleSteps: 0, continue: true })
  })
  it('increments idle when a step makes no progress', () => {
    const r = computeAgentProgress([{ name: 'update_working_memory', result: '[SYSTEM]: ok' }], 2, 5)
    expect(r).toEqual({ idleSteps: 3, continue: true })
  })
  it('stops the loop once idle reaches the threshold', () => {
    const r = computeAgentProgress([{ name: 'x', result: '[SYSTEM INTERCEPT]: ...' }], 4, 5)
    expect(r.idleSteps).toBe(5)
    expect(r.continue).toBe(false)
  })
  it('a mix with at least one real tool counts as progress', () => {
    const r = computeAgentProgress([
      { name: 'update_working_memory', result: '[SYSTEM]: ok' },
      { name: 'read_file', result: 'contents' },
    ], 4, 5)
    expect(r).toEqual({ idleSteps: 0, continue: true })
  })
  it('treats an empty result set as no progress', () => {
    expect(computeAgentProgress([], 0, 5)).toEqual({ idleSteps: 1, continue: true })
  })
  it('stops a thrashing agent: 5 consecutive all-fail command steps (different args each time)', () => {
    let state = { idleSteps: 0, continue: true }
    for (let i = 0; i < 5; i++) {
      state = computeAgentProgress(
        [{ name: 'execute_command', result: `tentativa ${i} falhou\n[exit code: 1]` }],
        state.idleSteps, 5,
      )
    }
    expect(state.idleSteps).toBe(5)
    expect(state.continue).toBe(false)
  })
  it('does NOT stop a legit debug loop (fail → edit → rerun resets idle)', () => {
    let state = { idleSteps: 0, continue: true }
    for (let i = 0; i < 10; i++) {
      // failing test run…
      state = computeAgentProgress(
        [{ name: 'execute_command', result: 'FAIL src/x.test.ts\n[exit code: 1]' }],
        state.idleSteps, 5,
      )
      expect(state.continue).toBe(true)
      // …followed by a fix attempt (real progress, resets idle)
      state = computeAgentProgress(
        [{ name: 'write_file', result: 'Arquivo escrito com sucesso' }],
        state.idleSteps, 5,
      )
      expect(state).toEqual({ idleSteps: 0, continue: true })
    }
  })
})
