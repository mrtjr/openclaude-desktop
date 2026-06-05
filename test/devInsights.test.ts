import { describe, it, expect, beforeEach } from 'vitest'
import {
  logInsight,
  drainInsights,
  hasBufferedInsights,
  setInsightsEnabled,
  summarizeInsights,
  formatInsightsReport,
  type InsightCategory,
  type InsightEvent,
} from '../src/services/devInsights'

beforeEach(() => {
  setInsightsEnabled(true)
  drainInsights()
})

describe('logInsight buffer', () => {
  it('buffers events and drain clears them', () => {
    expect(hasBufferedInsights()).toBe(false)
    logInsight('feature', 'open', { feature: 'orion' })
    logInsight('chat', 'turn', { provider: 'openai', model: 'gpt-4o' })
    expect(hasBufferedInsights()).toBe(true)
    const drained = drainInsights()
    expect(drained).toHaveLength(2)
    expect(drained[0]).toMatchObject({ c: 'feature', a: 'open' })
    expect(hasBufferedInsights()).toBe(false)
  })

  it('records nothing when disabled', () => {
    setInsightsEnabled(false)
    logInsight('chat', 'turn', { provider: 'x', model: 'y' })
    expect(hasBufferedInsights()).toBe(false)
  })

  it('drops non-primitive metadata (privacy guard), keeps primitives', () => {
    logInsight('chat', 'turn', { provider: 'openai', n: 5, ok: true, blob: { secret: 'message content' }, arr: [1, 2] })
    const [e] = drainInsights()
    expect(e.m).toEqual({ provider: 'openai', n: 5, ok: true }) // blob + arr dropped
  })
})

describe('summarizeInsights', () => {
  const now = 1_700_000_000_000
  const ev = (c: InsightCategory, a: string, m?: Record<string, string | number | boolean>, daysOld = 0): InsightEvent =>
    ({ t: now - daysOld * 86_400_000, c, a, m })

  it('aggregates errors by kind, features, mix, friction', () => {
    const events: InsightEvent[] = [
      ev('error', 'auth'), ev('error', 'auth'), ev('error', 'rate_limit'),
      ev('feature', 'open', { feature: 'orion' }), ev('feature', 'open', { feature: 'orion' }),
      ev('feature', 'open', { feature: 'rag' }),
      ev('chat', 'turn', { provider: 'openai', model: 'gpt-4o' }),
      ev('chat', 'turn', { provider: 'ollama', model: 'llama3' }),
      ev('tool', 'use', { name: 'web_search' }),
      ev('tool', 'denied'),
      ev('agent', 'circuit_break', { tool: 'read_file' }),
      ev('context', 'compaction', { dropped: 3 }),
      ev('chat', 'empty_reply'),
    ]
    const d = summarizeInsights(events, 30, now)
    expect(d.errorsByKind).toEqual({ auth: 2, rate_limit: 1 })
    expect(d.featureUsage).toEqual({ orion: 2, rag: 1 })
    expect(d.providerMix).toEqual({ openai: 1, ollama: 1 })
    expect(d.modelMix).toEqual({ 'gpt-4o': 1, llama3: 1 })
    expect(d.toolUsage).toEqual({ web_search: 1 })
    expect(d.friction).toEqual({ circuitBreaks: 1, retries: 0, toolDenials: 1, emptyReplies: 1, contextCompactions: 1 })
    expect(d.totalEvents).toBe(events.length)
  })

  it('aggregates turn latency (avg/p95) from complete events', () => {
    const events = [10, 20, 30, 40, 1000].map((ms) => ev('chat', 'complete', { ms }))
    const d = summarizeInsights(events, 30, now)
    expect(d.latency.count).toBe(5)
    expect(d.latency.avgMs).toBe(220) // (10+20+30+40+1000)/5
    expect(d.latency.p95Ms).toBe(40)  // index floor(0.95*4)=3 → sorted[3]
  })

  it('excludes events outside the window', () => {
    const events = [ev('error', 'auth', undefined, 0), ev('error', 'network', undefined, 60)]
    expect(summarizeInsights(events, 30, now).errorsByKind).toEqual({ auth: 1 })
  })

  it('produces a prioritisation note for a frequent error', () => {
    const events = Array.from({ length: 4 }, () => ev('error', 'rate_limit'))
    expect(summarizeInsights(events, 30, now).notes.some((n) => /rate_limit/.test(n))).toBe(true)
  })

  it('formatInsightsReport renders readable markdown from a digest', () => {
    const d = summarizeInsights([
      ev('error', 'auth'), ev('feature', 'open', { feature: 'orion' }),
      ev('chat', 'turn', { provider: 'openai', model: 'gpt-4o' }),
    ], 30, now)
    const md = formatInsightsReport(d)
    expect(md).toContain('# Dev Insights')
    expect(md).toContain('Erros por categoria')
    expect(md).toContain('auth: 1')
    expect(md).toContain('orion: 1')
    expect(md).toContain('## Atrito')
  })

  it('notes the most-used tool when frequent (surfaces the real-usage hotspot)', () => {
    const events = Array.from({ length: 3 }, () => ev('tool', 'use', { name: 'browser_navigate' }))
    const d = summarizeInsights(events, 30, now)
    expect(d.toolUsage).toEqual({ browser_navigate: 3 })
    expect(d.notes.some((n) => /browser_navigate/.test(n))).toBe(true)
  })

  it('empty input → zeroed digest', () => {
    const d = summarizeInsights([], 30, now)
    expect(d.totalEvents).toBe(0)
    expect(d.errorsByKind).toEqual({})
    expect(d.friction.circuitBreaks).toBe(0)
    expect(d.latency).toEqual({ count: 0, avgMs: 0, p95Ms: 0 })
  })
})
