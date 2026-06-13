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
  compareVersionSegments,
  drillEvents,
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
    expect(d.friction).toEqual({ circuitBreaks: 1, retries: 0, toolDenials: 1, emptyReplies: 1, contextCompactions: 1, rewriteExisting: 0 })
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

  it('denominador HONESTO: share inclui a espera (wait), não só geração', () => {
    // wait domina (60%): antes era excluído do denominador e escondido.
    const events = Array.from({ length: 3 }, () =>
      profile({ waitMs: 6000, reasoningMs: 1000, toolMs: 2000, contentMs: 1000, totalMs: 10_000 }))
    const d = summarizeInsights(events, 30, now)
    const f = d.findings.find((x) => x.id === 'cold-start-wait-dominant')!
    expect(f).toBeTruthy()
    expect(f.severity).toBe('critical')
    expect(f.evidence).toMatch(/60%/)
    expect(f.recommendation).toMatch(/keep-warm|min_containers|server-side/i)
  })

  it('atribui a montagem à ferramenta REAL via join turn+step (não chuta write_file)', () => {
    // 3 passos: stream_profile com toolMs alto + tool/use=execute_command no
    // mesmo (turn,step). A montagem deve ser atribuída a execute_command.
    const events: InsightEvent[] = []
    for (let i = 0; i < 3; i++) {
      events.push({ t: now - (100 - i) * 1000, c: 'chat', a: 'stream_profile', m: { waitMs: 100, reasoningMs: 200, toolMs: 9000, contentMs: 200, turn: 't1', step: i } })
      events.push({ t: now - (100 - i) * 1000 + 1, c: 'tool', a: 'use', m: { name: 'execute_command', ok: true, turn: 't1', step: i } })
    }
    const d = summarizeInsights(events, 30, now)
    expect(d.streamShare.toolMsByName.execute_command).toBe(27000)
    expect(d.streamShare.toolMsByName.write_file).toBeUndefined()
    const f = d.findings.find((x) => x.id === 'tool-assembly-dominant')!
    expect(f.evidence).toMatch(/execute_command/)
    expect(f.recommendation).toMatch(/script|arquivo/i)
    expect(f.recommendation).not.toMatch(/edit_file inteiro|write_file inteiro/)
  })

  it('passo com !=1 tool/use cai em unattributed (honesto, não inventa)', () => {
    const events: InsightEvent[] = [
      { t: now - 5000, c: 'chat', a: 'stream_profile', m: { toolMs: 5000, turn: 't1', step: 1 } },
      // dois tool/use no mesmo passo → ambíguo
      { t: now - 4999, c: 'tool', a: 'use', m: { name: 'execute_command', turn: 't1', step: 1 } },
      { t: now - 4998, c: 'tool', a: 'use', m: { name: 'read_file', turn: 't1', step: 1 } },
    ]
    const d = summarizeInsights(events, 30, now)
    expect(d.streamShare.toolMsByName.unattributed).toBe(5000)
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

describe('compareVersionSegments — o que mudou entre versões', () => {
  const now = 1_700_000_000_000
  const at = (minAgo: number) => now - minAgo * 60_000
  // Gera um "uso" completo de uma versão: turnos com desfecho + erros + perfis.
  const usage = (v: string | null, baseMinAgo: number, opts: { turns: number; errors?: string[]; toolMs?: number; contentMs?: number; ms?: number }): InsightEvent[] => {
    const events: InsightEvent[] = []
    const vm = v ? { v } : {}
    for (let i = 0; i < opts.turns; i++) {
      const id = `${v ?? 'legacy'}-${i}`
      const t0 = baseMinAgo - i * 2
      events.push({ t: at(t0), c: 'chat', a: 'turn', m: { ...vm, provider: 'modal', model: 'glm', turn: id } })
      events.push({ t: at(t0 - 1), c: 'chat', a: 'complete', m: { ...vm, ms: opts.ms ?? 100, turn: id, outcome: 'ok' } })
      if (opts.toolMs != null) {
        events.push({ t: at(t0 - 1), c: 'chat', a: 'stream_profile', m: { ...vm, waitMs: 0, reasoningMs: 0, toolMs: opts.toolMs, contentMs: opts.contentMs ?? 1000 } })
      }
    }
    for (const kind of opts.errors ?? []) {
      events.push({ t: at(baseMinAgo - 1), c: 'error', a: kind, m: { ...vm } })
    }
    return events
  }

  it('normaliza por turno e detecta melhora na taxa de erro', () => {
    const events = [
      ...usage('2.13.0', 200, { turns: 4, errors: ['timeout', 'timeout', 'timeout', 'timeout'] }),
      ...usage('2.14.0', 100, { turns: 4, errors: ['timeout'] }),
    ]
    const c = compareVersionSegments(events, now)!
    expect(c.current.v).toBe('2.14.0')
    expect(c.previous.v).toBe('2.13.0')
    expect(c.previous.errorRate).toBe(1)      // 4 erros / 4 turnos
    expect(c.current.errorRate).toBe(0.25)    // 1 erro / 4 turnos
  })

  it('aponta erros novos e resolvidos entre as versões', () => {
    const events = [
      ...usage('2.13.0', 200, { turns: 3, errors: ['timeout'] }),
      ...usage('2.14.0', 100, { turns: 3, errors: ['context'] }),
    ]
    const c = compareVersionSegments(events, now)!
    expect(c.newErrorKinds).toEqual(['context'])
    expect(c.resolvedErrorKinds).toEqual(['timeout'])
  })

  it('eventos sem versão caem no balde pré-2.14.0 (baseline imediato)', () => {
    const events = [
      ...usage(null, 200, { turns: 3, errors: ['timeout', 'timeout', 'timeout'] }),
      ...usage('2.14.0', 100, { turns: 3 }),
    ]
    const c = compareVersionSegments(events, now)!
    expect(c.previous.v).toBe('pré-2.14.0')
    expect(c.previous.errorRate).toBe(1)
    expect(c.current.errorRate).toBe(0)
  })

  it('exige ≥3 turnos por versão — amostra pequena não compara', () => {
    const events = [
      ...usage('2.13.0', 200, { turns: 3 }),
      ...usage('2.14.0', 100, { turns: 2 }), // atual com amostra insuficiente
    ]
    expect(compareVersionSegments(events, now)).toBeNull()
    expect(compareVersionSegments(usage('2.14.0', 100, { turns: 5 }), now)).toBeNull() // 1 versão só
  })

  it('compara o share de montagem de tool entre versões', () => {
    const events = [
      ...usage('2.14.0', 200, { turns: 3, toolMs: 9000, contentMs: 1000 }),
      ...usage('2.15.0', 100, { turns: 3, toolMs: 1000, contentMs: 9000 }),
    ]
    const c = compareVersionSegments(events, now)!
    expect(c.previous.toolSharePct).toBe(90)
    expect(c.current.toolSharePct).toBe(10)
  })

  it('digest integra o comparativo + nota de melhora; relatório tem a seção', () => {
    const events = [
      ...usage('2.13.0', 200, { turns: 4, errors: ['timeout', 'timeout', 'timeout', 'timeout'] }),
      ...usage('2.14.0', 100, { turns: 4, errors: [] }),
    ]
    const d = summarizeInsights(events, 30, now)
    expect(d.comparison?.current.v).toBe('2.14.0')
    expect(d.notes.some((n) => /taxa de erro caiu/.test(n))).toBe(true)
    expect(d.notes.some((n) => /Resolvido/.test(n) && /timeout/.test(n))).toBe(true)
    const md = formatInsightsReport(d)
    expect(md).toContain('## O que mudou (2.13.0 → 2.14.0)')
    expect(md).toContain('erros/turno: 1 → 0')
  })

  it('nota de regressão quando a taxa de erro sobe ≥50%', () => {
    const events = [
      ...usage('2.13.0', 200, { turns: 4, errors: ['timeout'] }),
      ...usage('2.14.0', 100, { turns: 4, errors: ['timeout', 'timeout', 'timeout'] }),
    ]
    const d = summarizeInsights(events, 30, now)
    expect(d.notes.some((n) => /regressão/.test(n))).toBe(true)
  })
})

describe('motor de findings — severidade, ranking e recomendação', () => {
  const now = 1_700_000_000_000
  const at = (minAgo: number) => now - minAgo * 60_000

  it('ranqueia por impacto: crítico > aviso > informativo', () => {
    const events: InsightEvent[] = [
      // zumbi (critical): turno com id sem complete + turno mais novo depois
      { t: at(300), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', turn: 'morto' } },
      { t: at(100), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', turn: 'vivo' } },
      { t: at(99), c: 'chat', a: 'complete', m: { ms: 10, turn: 'vivo', outcome: 'ok' } },
      // erro frequente (warning)
      ...Array.from({ length: 3 }, (): InsightEvent => ({ t: at(50), c: 'error', a: 'timeout' })),
      // tool mais usada (info)
      ...Array.from({ length: 3 }, (): InsightEvent => ({ t: at(40), c: 'tool', a: 'use', m: { name: 'web_search' } })),
    ]
    const d = summarizeInsights(events, 30, now)
    const ids = d.findings.map((f) => f.id)
    expect(ids[0]).toBe('zombie-turns')
    expect(ids.indexOf('frequent-error')).toBeLessThan(ids.indexOf('top-tool'))
    expect(d.findings[0].severity).toBe('critical')
  })

  it('recomendação específica por categoria de erro', () => {
    const mk = (kind: string) => summarizeInsights(
      Array.from({ length: 3 }, (): InsightEvent => ({ t: now - 1000, c: 'error', a: kind })), 30, now)
    expect(mk('timeout').findings.find((f) => f.id === 'frequent-error')!.recommendation).toMatch(/watchdog|timeout/i)
    expect(mk('auth').findings.find((f) => f.id === 'frequent-error')!.recommendation).toMatch(/credencia/i)
    expect(mk('unknown').findings.find((f) => f.id === 'frequent-error')!.recommendation).toMatch(/providerErrors/i)
    expect(mk('inedito').findings.find((f) => f.id === 'frequent-error')!.recommendation).toMatch(/Investigar/i)
  })

  it('todo finding tem evidência e recomendação; notes deriva 1:1 dos findings', () => {
    const events: InsightEvent[] = [
      ...Array.from({ length: 5 }, (): InsightEvent => ({ t: now - 1000, c: 'context', a: 'compaction' })),
      ...Array.from({ length: 3 }, (): InsightEvent => ({ t: now - 1000, c: 'chat', a: 'empty_reply' })),
    ]
    const d = summarizeInsights(events, 30, now)
    expect(d.findings.length).toBeGreaterThan(0)
    for (const f of d.findings) {
      expect(f.evidence.length).toBeGreaterThan(0)
      expect(f.recommendation.length).toBeGreaterThan(0)
      expect(['critical', 'warning', 'info']).toContain(f.severity)
    }
    expect(d.notes).toHaveLength(d.findings.length)
    expect(d.notes[0]).toContain(d.findings[0].title)
  })

  it('relatório .md traz os achados com ícone de severidade', () => {
    const events: InsightEvent[] = [
      { t: at(300), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', turn: 'morto' } },
      { t: at(100), c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', turn: 'vivo' } },
      { t: at(99), c: 'chat', a: 'complete', m: { ms: 10, turn: 'vivo', outcome: 'ok' } },
    ]
    const md = formatInsightsReport(summarizeInsights(events, 30, now))
    expect(md).toContain('## Achados (por impacto)')
    expect(md).toContain('🔴')
    expect(md).toContain('Turnos zumbis')
  })

  it('sem sinais → sem findings (não inventa achado sem evidência)', () => {
    const d = summarizeInsights([
      { t: now - 1000, c: 'chat', a: 'turn', m: { provider: 'x', model: 'y', turn: 'a' } },
      { t: now - 500, c: 'chat', a: 'complete', m: { ms: 10, turn: 'a', outcome: 'ok' } },
    ], 30, now)
    expect(d.findings.filter((f) => f.severity !== 'info')).toHaveLength(0)
  })
})

describe('drillEvents — timeline por trás de um achado', () => {
  const now = 1_700_000_000_000
  const at = (minAgo: number) => now - minAgo * 60_000
  const base: InsightEvent[] = [
    { t: at(300), c: 'chat', a: 'turn', m: { provider: 'modal', model: 'glm', turn: 'morto', v: '2.14.0' } },
    { t: at(299), c: 'tool', a: 'use', m: { name: 'web_search', turn: 'morto', step: 1 } },
    { t: at(298), c: 'tool', a: 'use', m: { name: 'write_file', turn: 'morto', step: 2 } },
    { t: at(100), c: 'chat', a: 'turn', m: { provider: 'modal', model: 'glm', turn: 'vivo', v: '2.15.0' } },
    { t: at(99), c: 'error', a: 'timeout', m: { turn: 'vivo', v: '2.15.0' } },
    { t: at(98), c: 'error', a: 'auth', m: { turn: 'vivo', v: '2.15.0' } },
    { t: at(97), c: 'chat', a: 'complete', m: { ms: 10, turn: 'vivo', outcome: 'ok', v: '2.15.0' } },
    { t: at(50), c: 'chat', a: 'stream_profile', m: { waitMs: 0, reasoningMs: 0, toolMs: 400_000, contentMs: 100 } },
    { t: at(40), c: 'chat', a: 'stream_profile', m: { waitMs: 0, reasoningMs: 0, toolMs: 100, contentMs: 100 } },
  ]

  it('errors: filtra por kind e por versão', () => {
    expect(drillEvents(base, { type: 'errors', kind: 'timeout' }, now)).toHaveLength(1)
    expect(drillEvents(base, { type: 'errors', v: '2.15.0' }, now)).toHaveLength(2)
    expect(drillEvents(base, { type: 'errors', kind: 'auth', v: '2.14.0' }, now)).toHaveLength(0)
  })

  it('turn: devolve a timeline completa do turno, mais novo primeiro', () => {
    const tl = drillEvents(base, { type: 'turn', id: 'morto' }, now)
    expect(tl.map((e) => `${e.c}/${e.a}`)).toEqual(['tool/use', 'tool/use', 'chat/turn'])
    expect(tl[0].m?.name).toBe('write_file') // o último ato antes de morrer
  })

  it('zombie-turns: devolve só os turnos sem desfecho (mesma semântica do digest)', () => {
    const z = drillEvents(base, { type: 'zombie-turns' }, now)
    expect(z).toHaveLength(1)
    expect(z[0].m?.turn).toBe('morto')
  })

  it('long-tool-assemblies: só perfis com 5+ min de montagem', () => {
    const l = drillEvents(base, { type: 'long-tool-assemblies' }, now)
    expect(l).toHaveLength(1)
    expect(l[0].m?.toolMs).toBe(400_000)
  })

  it('tool/feature/action: filtros simples por nome e ação', () => {
    expect(drillEvents(base, { type: 'tool', name: 'web_search' }, now)).toHaveLength(1)
    expect(drillEvents(base, { type: 'action', c: 'chat', a: 'stream_profile' }, now)).toHaveLength(2)
  })

  it('respeita o cap e ordena do mais novo para o mais antigo', () => {
    const many: InsightEvent[] = Array.from({ length: 80 }, (_, i) => ({ t: at(80 - i), c: 'error', a: 'timeout' }))
    const r = drillEvents(many, { type: 'errors' }, now)
    expect(r).toHaveLength(50)
    expect(r[0].t).toBeGreaterThan(r[49].t)
  })

  it('finding prefer-edit-file dispara com ≥3 reescritas de arquivo existente', () => {
    const events = Array.from({ length: 3 }, (): InsightEvent =>
      ({ t: now - 1000, c: 'tool', a: 'rewrite_existing', m: { bytes: 9000 } }))
    const d = summarizeInsights(events, 30, now)
    expect(d.friction.rewriteExisting).toBe(3)
    const f = d.findings.find((x) => x.id === 'prefer-edit-file')!
    expect(f.severity).toBe('warning')
    expect(f.recommendation).toMatch(/edit_file/)
    expect(f.drill).toEqual({ type: 'action', c: 'tool', a: 'rewrite_existing' })
  })

  it('findings carregam o seletor de drill correspondente', () => {
    const d = summarizeInsights([
      ...base,
      ...Array.from({ length: 3 }, (): InsightEvent => ({ t: at(10), c: 'error', a: 'timeout' })),
    ], 30, now)
    expect(d.findings.find((f) => f.id === 'zombie-turns')?.drill).toEqual({ type: 'zombie-turns' })
    expect(d.findings.find((f) => f.id === 'frequent-error')?.drill).toEqual({ type: 'errors', kind: 'timeout' })
  })
})
