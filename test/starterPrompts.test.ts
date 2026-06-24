import { describe, it, expect } from 'vitest'
import { starterPrompts } from '../src/utils/starterPrompts'

describe('starterPrompts', () => {
  it('returns a non-empty curated set per language', () => {
    const pt = starterPrompts('pt')
    const en = starterPrompts('en')
    expect(pt.length).toBeGreaterThanOrEqual(3)
    expect(en.length).toBe(pt.length)
  })

  it('every prompt has an emoji, a short label and complete, send-ready text', () => {
    for (const lang of ['pt', 'en'] as const) {
      for (const sp of starterPrompts(lang)) {
        expect(sp.emoji.trim().length).toBeGreaterThan(0)
        expect(sp.label.trim().length).toBeGreaterThan(0)
        expect(sp.text.trim().length).toBeGreaterThan(20)
        // Ready to send: no unfilled [placeholders] that would send junk.
        expect(sp.text).not.toMatch(/\[[^\]]+\]/)
      }
    }
  })

  it('falls back to English for an unknown language', () => {
    // @ts-expect-error — exercising the runtime fallback path
    expect(starterPrompts('zz')).toEqual(starterPrompts('en'))
  })
})
