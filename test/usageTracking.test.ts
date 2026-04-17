// Pure-function tests around the useUsageTracking logic. We test the
// getSummary computation by building entries directly and invoking the
// pricing helpers — no hook renderer needed.

import { describe, it, expect } from 'vitest'
import { calculateCost } from '../src/constants/pricing'

interface UsageEntry {
  timestamp: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
}

function makeEntry(provider: string, model: string, inp: number, out: number, ts: number): UsageEntry {
  return { provider, model, inputTokens: inp, outputTokens: out, cost: calculateCost(inp, out, model), timestamp: ts }
}

function summarise(entries: UsageEntry[], days: number) {
  const cutoff = Date.now() - days * 86400_000
  const filtered = entries.filter(e => e.timestamp >= cutoff)
  const byProvider: Record<string, { cost: number; count: number }> = {}
  const byModel: Record<string, { cost: number; count: number }> = {}
  let totalCost = 0
  for (const e of filtered) {
    totalCost += e.cost
    byProvider[e.provider] ??= { cost: 0, count: 0 }
    byProvider[e.provider].cost += e.cost
    byProvider[e.provider].count++
    byModel[e.model] ??= { cost: 0, count: 0 }
    byModel[e.model].cost += e.cost
    byModel[e.model].count++
  }
  return { totalCost, byProvider, byModel, entries: filtered }
}

describe('usage summary aggregation', () => {
  it('sums cost across entries and groups by provider/model', () => {
    const now = Date.now()
    const entries = [
      makeEntry('openai', 'gpt-4o-mini', 1000, 500, now - 1000),
      makeEntry('openai', 'gpt-4o', 2000, 1000, now - 2000),
      makeEntry('anthropic', 'claude-3-5-sonnet-20241022', 1500, 800, now - 3000),
    ]
    const s = summarise(entries, 30)
    expect(s.entries).toHaveLength(3)
    expect(s.totalCost).toBeGreaterThan(0)
    expect(s.byProvider.openai.count).toBe(2)
    expect(s.byProvider.anthropic.count).toBe(1)
    expect(Object.keys(s.byModel)).toHaveLength(3)
  })

  it('excludes entries older than the window', () => {
    const now = Date.now()
    const entries = [
      makeEntry('openai', 'gpt-4o', 100, 100, now - 1000),              // in window
      makeEntry('openai', 'gpt-4o', 100, 100, now - 60 * 86400_000),    // 60 days ago
    ]
    const s = summarise(entries, 30)
    expect(s.entries).toHaveLength(1)
  })

  it('treats local models as zero cost', () => {
    const now = Date.now()
    const entries = [
      makeEntry('ollama', 'llama3:8b', 100_000, 50_000, now),
    ]
    const s = summarise(entries, 30)
    expect(s.totalCost).toBe(0)
    expect(s.byProvider.ollama.cost).toBe(0)
  })
})
