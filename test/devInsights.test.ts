import { describe, it, expect, beforeEach } from 'vitest'
import {
  logInsight,
  drainInsights,
  hasBufferedInsights,
  setInsightsEnabled,
  summarizeInsights,
  formatInsightsReport,
  beginInsightTurn,
  bumpInsightStep,
  endInsightTurn,
  type InsightCategory,
  type InsightEvent,
} from '../src/services/devInsights'

beforeEach(() => {
  setInsightsEnabled(true)
  endInsightTurn()
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
    expect(d.turns).toEqual({ started: 0, completed: 0, aborted: 0, errored: 0, zombies: 0 })
    expect(d.streamShare.samples).toBe(0)
  })
})

describe('contexto de turno (correlação turn/step)', () => {
  it('anexa turn e step a todo evento enquanto o turno está ativo', () => {
    const id = beginInsightTurn()
    bumpInsightStep()
    logInsight('tool', 'use', { name: 'web_search' })
    bumpInsightStep()
    logInsight('tool', 'use', { name: 'write_file' })
    endInsightTurn()
    logInsight('feature', 'open', { feature: 'rag' }) // fora do turno
    const [e1, e2, e3] = drainInsights()
    expect(e1.m).toMatchObject({ turn: id, step: 1, name: 'web_search' })
    expect(e2.m).toMatchObject({ turn: id, step: 2, name: 'write_file' })
    expect(e3.m?.turn).toBeUndefined()
  })

  it('meta explícito vence o contexto em caso de colisão de chave', () => {
    beginInsightTurn()
    logInsight('chat', 'complete', { step: 99 })
    endInsightTurn()
    const [e] = drainInsights()
    expect(e.m?.step).toBe(99)
  })
})

describe('summarizeInsights — ciclo de vida dos turnos', () => {
  const now = 1_700_000_000_000
  const at = (minAgo: number) => now - minAgo * 60_000
  const turn = (id: string, minAgo: number): InsightEvent =>
    ({ t: at(minAgo), c: 'chat', a: 'turn', m: { provider: 'modal', model: 'glm', turn: id } })
  const complete = (id: string, outcome: string, minAgo: number): InsightEvent =>
    ({ t: at(minAgo), c: 'chat', a: 'complete', m: { ms: 100, turn: id, outcome } })

  it('conta desfechos por turno: ok, error, aborted', () => {
    const d = summarizeInsights([
      turn('a', 50), complete('a', 'ok', 45),
      turn('b', 40), complete('b', 'error', 35),
      turn('c', 30), complete('c', 'aborted', 25),
    ], 30 as any, now)
    expect(d.turns).toEqual({ started: 3, completed: 1, errored: 1, aborted: 1, zombies: 0 })
  })

  it('turno sem complete vira zumbi quando um turno mais novo existe', () => {
    const d = summarizeInsights([
      turn('morto', 90),            // nunca completou…
      turn('novo', 10), complete('novo', 'ok', 5), // …e um turno posterior prova que morreu
    ], 30, now)
    expect(d.turns.zombies).toBe(1)
    expect(d.notes.some((n) => /zumbi/.test(n))).toBe(true)
  })

  it('o turno mais recente sem desfecho NÃO é zumbi (pode estar rodando)', () => {
    const d = summarizeInsights([turn('ativo', 10)], 30, now)
    expect(d.turns.zombies).toBe(0)
  })

  it('…mas vira zumbi depois de 2h sem desfecho', () => {
    const d = summarizeInsights([turn('esquecido', 130)], 30, now)
    expect(d.turns.zombies).toBe(1)
  })

  it('complete legado (sem turn/outcome) conta como completo', () => {
    const d = summarizeInsights([
      { t: at(20), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y' } },
      { t: at(15), c: 'chat', a: 'complete', m: { ms: 50 } },
    ], 30, now)
    expect(d.turns.started).toBe(1)
    expect(d.turns.completed).toBe(1)
    expect(d.turns.zombies).toBe(0)
  })

  it('agrega versionMix a partir de m.v nos eventos de turno', () => {
    const d = summarizeInsights([
      { t: at(20), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', v: '2.14.0', turn: 'a' } },
      { t: at(10), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', v: '2.14.0', turn: 'b' } },
      { t: at(5), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', v: '2.13.4', turn: 'c' } },
    ], 30, now)
    expect(d.versionMix).toEqual({ '2.14.0': 2, '2.13.4': 1 })
  })
})

describe('summarizeInsights — perfil de geração (stream_profile)', () => {
  const now = 1_700_000_000_000
  const profile = (m: Record<string, number>): InsightEvent =>
    ({ t: now - 60_000, c: 'chat', a: 'stream_profile', m })

  it('soma os buckets e conta montagens longas de tool call', () => {
    const d = summarizeInsights([
      profile({ waitMs: 1000, reasoningMs: 2000, toolMs: 400_000, contentMs: 1000, totalMs: 404_000 }),
      profile({ waitMs: 500, reasoningMs: 1500, toolMs: 100, contentMs: 3000, totalMs: 5100 }),
    ], 30, now)
    expect(d.streamShare.samples).toBe(2)
    expect(d.streamShare.toolMs).toBe(400_100)
    expect(d.streamShare.longToolAssemblies).toBe(1) // só a de 400s passa de 5 min
  })

  it('nota quando a montagem de tool domina o tempo de geração (≥3 amostras)', () => {
    const events = Array.from({ length: 3 }, () =>
      profile({ waitMs: 100, reasoningMs: 1000, toolMs: 8000, contentMs: 1000, totalMs: 10_100 }))
    const d = summarizeInsights(events, 30, now)
    expect(d.notes.some((n) => /tool call/i.test(n) && /80%/.test(n))).toBe(true)
  })

  it('relatório .md inclui as seções de turnos e perfil', () => {
    const d = summarizeInsights([
      { t: now - 1000, c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', turn: 'a' } },
      { t: now - 500, c: 'chat', a: 'complete', m: { ms: 10, turn: 'a', outcome: 'ok' } },
      profile({ waitMs: 100, reasoningMs: 200, toolMs: 300, contentMs: 400, totalMs: 1000 }),
    ], 30, now)
    const md = formatInsightsReport(d)
    expect(md).toContain('## Turnos')
    expect(md).toContain('zumbis: 0')
    expect(md).toContain('## Perfil de geração')
  })
})
