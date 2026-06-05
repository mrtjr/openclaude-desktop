import { describe, it, expect } from 'vitest'
import { cachedSystem, withCachedTools } from '../electron/anthropic-cache.js'

describe('cachedSystem', () => {
  it('wraps system text in a cached text block', () => {
    expect(cachedSystem('you are helpful')).toEqual([
      { type: 'text', text: 'you are helpful', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('returns undefined for empty / missing system', () => {
    expect(cachedSystem('')).toBeUndefined()
    expect(cachedSystem(undefined as any)).toBeUndefined()
  })
})

describe('withCachedTools', () => {
  it('marks only the LAST tool with cache_control (caches the whole prefix)', () => {
    const out = withCachedTools([{ name: 'a' }, { name: 'b' }, { name: 'c' }]) as any[]
    expect(out[0].cache_control).toBeUndefined()
    expect(out[1].cache_control).toBeUndefined()
    expect(out[2].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('does not mutate the input', () => {
    const tools = [{ name: 'a' }]
    const out = withCachedTools(tools) as any[]
    expect(tools[0]).not.toHaveProperty('cache_control')
    expect(out[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('handles empty / undefined tool lists', () => {
    expect(withCachedTools([])).toEqual([])
    expect(withCachedTools(undefined as any)).toBeUndefined()
  })
})
