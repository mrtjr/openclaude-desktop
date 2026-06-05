// ─── Lazy real tokenizer tests ─────────────────────────────────────
//
// These run in order within this file (vitest is sequential per-file) and
// share one module-global tokenizer state, mirroring katexLoader.test.ts.
// The contextEngine tests live in their own file, where the tokenizer is
// never loaded, so they keep exercising the deterministic char/4 fallback.

import { describe, it, expect } from 'vitest'
import {
  isTokenizerReady,
  onTokenizerReady,
  ensureTokenizer,
  realTokenCount,
} from '../src/services/tokenizer'
import { createContextEngine } from '../src/services/contextEngine'

const waitReady = () =>
  new Promise<void>((resolve) => {
    if (isTokenizerReady()) return resolve()
    const off = onTokenizerReady(() => {
      off()
      resolve()
    })
  })

describe('lazy real tokenizer', () => {
  it('starts idle — nothing loaded at import time', () => {
    expect(isTokenizerReady()).toBe(false)
    // Before the lazy load, callers get null and fall back to their heuristic.
    expect(realTokenCount('hello world')).toBeNull()
  })

  it('loads on demand and returns exact o200k_base counts', async () => {
    ensureTokenizer()
    await waitReady()
    expect(isTokenizerReady()).toBe(true)
    expect(realTokenCount('hello world')).toBe(2)
    expect(realTokenCount('')).toBe(0)
  })

  it('counts JSON & CJK far denser than char/4 — the overflow risk it fixes', () => {
    // Tool results are JSON; char/4 under-counts them by ~half, which is
    // exactly what let the chat loop overflow the real context window.
    const json = '{"a":1,"b":[2,3]}'
    const real = realTokenCount(json)!
    expect(real).toBeGreaterThan(Math.ceil(json.length / 4)) // 11 vs 5

    const cjk = '文文文文文'
    expect(realTokenCount(cjk)!).toBeGreaterThan(Math.ceil(cjk.length / 4)) // 5 vs 2
  })

  it('is single-flight — repeated ensure() calls keep the ready state', () => {
    ensureTokenizer()
    ensureTokenizer()
    expect(isTokenizerReady()).toBe(true)
  })

  it('returns a stable, memoized count for repeated identical content', () => {
    const s = 'the quick brown fox jumps over the lazy dog'
    const a = realTokenCount(s)
    const b = realTokenCount(s)
    expect(a).toBe(b)
    expect(a).toBeGreaterThan(0)
  })

  it('never throws on text containing special-token markers', () => {
    const txt = 'before <|endoftext|> after'
    expect(() => realTokenCount(txt)).not.toThrow()
    expect(realTokenCount(txt)!).toBeGreaterThan(0)
  })

  it('contextEngine.countTokens uses the real tokenizer once ready', () => {
    // Wiring proof: the engine's estimate must match the real count for
    // dense content (it would diverge if it were still on the heuristic).
    const engine = createContextEngine()
    const json = '{"role":"tool","content":"[1,2,3,4,5]"}'
    expect(engine.countTokens(json)).toBe(realTokenCount(json))
  })
})
