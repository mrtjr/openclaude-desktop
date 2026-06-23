import { describe, it, expect } from 'vitest'
import { decideDeferral, AUTO_DEFER_CONTEXT_RATIO } from '../src/services/toolDeferral'

describe('decideDeferral', () => {
  it('honours explicit on/off regardless of size', () => {
    expect(decideDeferral('on', 1_000_000, 100).enabled).toBe(true)
    expect(decideDeferral('off', 8192, 999_999).enabled).toBe(false)
  })

  it('auto: leaves roomy models eager (few tools, big context)', () => {
    // 5k tools / 128k ctx ≈ 4% < 15%
    expect(decideDeferral('auto', 128_000, 5000).enabled).toBe(false)
    // 5k / 64k ≈ 8% < 15%
    expect(decideDeferral('auto', 64_000, 5000).enabled).toBe(false)
  })

  it('auto: defers on small-context models (Ollama 8k/16k)', () => {
    expect(decideDeferral('auto', 8192, 5000).enabled).toBe(true)   // ~61%
    expect(decideDeferral('auto', 16_384, 5000).enabled).toBe(true) // ~31%
  })

  it('auto: defers on any model once tools balloon past the threshold', () => {
    // e.g. MCP adds many tools → 30k of schemas even on a 128k model = 23%
    expect(decideDeferral('auto', 128_000, 30_000).enabled).toBe(true)
  })

  it('treats undefined mode as auto', () => {
    expect(decideDeferral(undefined, 8192, 5000).enabled).toBe(true)
    expect(decideDeferral(undefined, 128_000, 5000).enabled).toBe(false)
  })

  it('enables exactly at the threshold (>=) and not just below', () => {
    // ratio === 0.15 → enabled
    expect(decideDeferral('auto', 100, 15).enabled).toBe(true)
    // ratio just under → disabled
    expect(decideDeferral('auto', 100, 14).enabled).toBe(false)
    expect(AUTO_DEFER_CONTEXT_RATIO).toBe(0.15)
  })

  it('never divides by zero on an unknown/zero context limit', () => {
    expect(decideDeferral('auto', 0, 5000).enabled).toBe(false)
  })

  it('returns the resolved mode and a human-readable reason', () => {
    const d = decideDeferral('auto', 8192, 5000)
    expect(d.mode).toBe('auto')
    expect(typeof d.reason).toBe('string')
    expect(d.reason.length).toBeGreaterThan(0)
  })
})

describe('decideDeferral — modelo desconhecido (v2.127.0)', () => {
  it('NÃO defere quando o limite é desconhecido, mesmo com tools "grandes" no default 8k', () => {
    // 2200 tokens / 8192 = 27% ≥ 15% → DEFERIRIA se conhecido; mas desconhecido não defere.
    const d = decideDeferral('auto', 8192, 2200, false)
    expect(d.enabled).toBe(false)
    expect(d.reason).toMatch(/desconhecido/)
  })
  it('modelo conhecido segue a regra de ratio normalmente', () => {
    expect(decideDeferral('auto', 8192, 2200, true).enabled).toBe(true)   // 27% ≥ 15%
    expect(decideDeferral('auto', 200000, 2200, true).enabled).toBe(false) // ~1% < 15%
  })
  it('forced on/off ignoram o knownLimit', () => {
    expect(decideDeferral('on', 8192, 100, false).enabled).toBe(true)
    expect(decideDeferral('off', 8192, 9999, true).enabled).toBe(false)
  })
})
