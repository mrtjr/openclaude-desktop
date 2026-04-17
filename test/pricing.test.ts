import { describe, it, expect } from 'vitest'
import { PRICING, getModelPricing, calculateCost, formatCost } from '../src/constants/pricing'

describe('getModelPricing', () => {
  it('returns exact match for known models', () => {
    expect(getModelPricing('gpt-4o')).toEqual(PRICING['gpt-4o'])
    expect(getModelPricing('claude-sonnet-4-20250514')).toEqual(PRICING['claude-sonnet-4-20250514'])
  })

  it('falls back to prefix match (case-insensitive substring)', () => {
    // A versioned OpenRouter id that contains a known key as substring
    const p = getModelPricing('openai/gpt-4o-2024-11-20')
    expect(p.input).toBeGreaterThan(0)
  })

  it('returns {0,0} for unknown models (e.g. local Ollama)', () => {
    expect(getModelPricing('llama3:8b')).toEqual({ input: 0, output: 0 })
    expect(getModelPricing('some-nonexistent-model')).toEqual({ input: 0, output: 0 })
  })
})

describe('calculateCost', () => {
  it('scales linearly with token counts', () => {
    // gpt-4o-mini: $0.15/M input, $0.60/M output
    const cost = calculateCost(1_000_000, 0, 'gpt-4o-mini')
    expect(cost).toBeCloseTo(0.15, 5)
    const cost2 = calculateCost(0, 1_000_000, 'gpt-4o-mini')
    expect(cost2).toBeCloseTo(0.60, 5)
  })

  it('sums input + output costs', () => {
    // 1k input + 1k output on gpt-4o ($2.50 / $10.00 per M)
    const expected = (1000 * 2.5 + 1000 * 10) / 1_000_000
    expect(calculateCost(1000, 1000, 'gpt-4o')).toBeCloseTo(expected, 8)
  })

  it('returns 0 for local/unknown models', () => {
    expect(calculateCost(10_000, 10_000, 'llama3')).toBe(0)
  })
})

describe('formatCost', () => {
  it('formats exactly zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('uses 4 decimals for sub-cent amounts', () => {
    expect(formatCost(0.0012)).toBe('$0.0012')
  })

  it('uses 3 decimals for sub-dollar amounts', () => {
    expect(formatCost(0.123)).toBe('$0.123')
  })

  it('uses 2 decimals for dollar amounts', () => {
    expect(formatCost(1.2345)).toBe('$1.23')
    expect(formatCost(99.999)).toBe('$100.00')
  })
})
