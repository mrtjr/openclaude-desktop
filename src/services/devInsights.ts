// ─── Dev Insights — privacy-safe usage telemetry ───────────────────
//
// Captures *events + metadata only* (never message content) so the project
// can be evolved from real usage instead of guesswork. Events are buffered
// in memory and flushed in batches to the main process (see useDevInsights);
// the main process appends them to userData/dev-insights.json and writes a
// pre-aggregated userData/dev-insights-digest.json that the maintainer reads
// each cycle to prioritise improvements.
//
// Privacy is structural: meta accepts ONLY primitives, and anything non-
// primitive (objects/arrays — where message content would live) is dropped.
// Errors are logged as their *category* (classifyProviderError kind), never
// the raw text. Honors the existing `analyticsEnabled` setting.

export type InsightCategory = 'chat' | 'error' | 'tool' | 'feature' | 'context' | 'provider' | 'agent'

export interface InsightEvent {
  t: number   // timestamp (ms)
  c: InsightCategory
  a: string   // action: error kind, feature name, 'turn', 'use', 'denied', 'compaction', …
  m?: Record<string, string | number | boolean>
}

export interface InsightsDigest {
  generatedAt: number
  windowDays: number
  totalEvents: number
  errorsByKind: Record<string, number>
  featureUsage: Record<string, number>
  toolUsage: Record<string, number>
  providerMix: Record<string, number>
  modelMix: Record<string, number>
  friction: {
    circuitBreaks: number
    retries: number
    toolDenials: number
    emptyReplies: number
    contextCompactions: number
  }
  /** Turn latency over the window (ms), from 'chat'/'complete' events. */
  latency: { count: number; avgMs: number; p95Ms: number }
  /** Ciclo de vida dos turnos (v2.14.0). Zumbi = começou e nunca registrou
   *  desfecho — app fechado no meio, crash ou stream preso. */
  turns: { started: number; completed: number; aborted: number; errored: number; zombies: number }
  /** Onde foi o tempo de geração (somas em ms dos 'chat'/'stream_profile').
   *  longToolAssemblies conta passos com 5+ min só montando uma tool call. */
  streamShare: { samples: number; waitMs: number; reasoningMs: number; toolMs: number; contentMs: number; longToolAssemblies: number }
  /** Turnos por versão do app — mede o efeito de cada release. */
  versionMix: Record<string, number>
  /** Auto-generated, human/AI-readable prioritisation hints. */
  notes: string[]
}

// Turno mais recente sem desfecho só vira zumbi depois desta idade (pode
// ainda estar rodando); os anteriores ao último turno são zumbis na hora —
// o app roda um turno por vez (sendingRef), então um novo turno prova que
// o anterior morreu sem registrar desfecho.
const ZOMBIE_AGE_MS = 2 * 60 * 60 * 1000
const LONG_TOOL_ASSEMBLY_MS = 5 * 60 * 1000

// ─── In-memory buffer ───────────────────────────────────────────────
const buffer: InsightEvent[] = []
let enabled = true

// ─── Contexto de turno (correlação) — v2.14.0 ───────────────────────
// Antes os eventos eram um fluxo achatado: impossível responder "o turno
// terminou?", "em que passo deu erro?", "qual versão introduziu isso?".
// Enquanto um turno está ativo, todo evento ganha automaticamente:
//   m.turn — id curto correlacionando turno → tools → desfecho
//   m.step — passo do loop agêntico em que o evento ocorreu
//   m.v    — versão do app (mede o efeito de cada ciclo de release)
// Turno SEM evento 'chat/complete' = zumbi (app fechado no meio, crash ou
// stream preso — foi exatamente o buraco do diagnóstico do ciclo v2.13.x).
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''
let turnCtx: { id: string; step: number } | null = null

/** Inicia o contexto de correlação de um turno; devolve o id gerado. */
export function beginInsightTurn(): string {
  turnCtx = { id: Math.random().toString(36).slice(2, 10), step: 0 }
  return turnCtx.id
}

/** Avança o passo do loop agêntico (chamar a cada iteração). */
export function bumpInsightStep(): void {
  if (turnCtx) turnCtx.step++
}

/** Encerra o contexto (depois de logar o 'chat/complete'). */
export function endInsightTurn(): void {
  turnCtx = null
}

/** Mirror the user's `analyticsEnabled` setting — when off, nothing is recorded. */
export function setInsightsEnabled(on: boolean): void {
  enabled = on
}

/** Keep only primitives. Drops objects/arrays (where message content would
 *  otherwise leak) and bounds string length defensively. */
function sanitizeMeta(meta?: Record<string, unknown>): InsightEvent['m'] {
  if (!meta) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string') out[k] = v.length > 64 ? v.slice(0, 64) : v
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    // non-primitives intentionally dropped (privacy guard)
  }
  return Object.keys(out).length ? out : undefined
}

/** Record a usage event. Cheap + synchronous; the flush hook persists it. */
export function logInsight(
  category: InsightCategory,
  action: string,
  meta?: Record<string, unknown>,
): void {
  if (!enabled) return
  // Contexto de turno entra por baixo do meta explícito (explícito vence).
  const ctx: Record<string, unknown> = {}
  if (APP_VERSION) ctx.v = APP_VERSION
  if (turnCtx) { ctx.turn = turnCtx.id; ctx.step = turnCtx.step }
  const merged = Object.keys(ctx).length ? { ...ctx, ...meta } : meta
  buffer.push({ t: Date.now(), c: category, a: String(action), m: sanitizeMeta(merged) })
}

/** Remove and return all buffered events (called by the flush hook). */
export function drainInsights(): InsightEvent[] {
  return buffer.splice(0, buffer.length)
}

export function hasBufferedInsights(): boolean {
  return buffer.length > 0
}

// ─── Aggregation (pure) ─────────────────────────────────────────────

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] || 0) + 1
}

function buildNotes(d: Omit<InsightsDigest, 'notes'>): string[] {
  const notes: string[] = []
  // Zumbis primeiro: é o sinal mais grave (turno morreu sem registrar nada).
  if (d.turns.zombies > 0) {
    notes.push(`${d.turns.zombies} turno(s) zumbi — começaram e nunca registraram desfecho (app fechado no meio, crash ou stream preso).`)
  }
  // Perfil de geração: onde o tempo realmente foi (≥3 amostras para não
  // tirar conclusão de um turno só).
  const gen = d.streamShare.reasoningMs + d.streamShare.toolMs + d.streamShare.contentMs
  if (d.streamShare.samples >= 3 && gen > 0) {
    const toolPct = Math.round((d.streamShare.toolMs / gen) * 100)
    const reasonPct = Math.round((d.streamShare.reasoningMs / gen) * 100)
    if (toolPct >= 40) {
      notes.push(`Montagem de tool call consome ${toolPct}% do tempo de geração — candidata: tool de edição por trecho em vez de write_file inteiro.`)
    }
    if (reasonPct >= 50) {
      notes.push(`Raciocínio consome ${reasonPct}% do tempo de geração — avaliar limite de thinking ou modelo mais direto para tarefas simples.`)
    }
  }
  if (d.streamShare.longToolAssemblies >= 2) {
    notes.push(`${d.streamShare.longToolAssemblies} passo(s) com 5+ min só montando tool call — turnos "parados" que parecem travamento.`)
  }
  const topError = Object.entries(d.errorsByKind).sort((a, b) => b[1] - a[1])[0]
  if (topError && topError[1] >= 3) {
    notes.push(`Erro mais frequente: "${topError[0]}" (${topError[1]}×) — bom candidato a próximo ciclo.`)
  }
  if (d.friction.contextCompactions >= 5) {
    notes.push(`Pressão de contexto alta: ${d.friction.contextCompactions} compactações.`)
  }
  if (d.friction.circuitBreaks >= 3) {
    notes.push(`Circuit-breaks recorrentes (${d.friction.circuitBreaks}) — possíveis loops de agente.`)
  }
  if (d.friction.toolDenials >= 3) {
    notes.push(`Muitas tools negadas (${d.friction.toolDenials}) — revisar gating/UX de permissão.`)
  }
  if (d.friction.emptyReplies >= 3) {
    notes.push(`Respostas vazias frequentes (${d.friction.emptyReplies}) — modelo/provider problemático.`)
  }
  if (d.latency.count >= 5 && d.latency.p95Ms >= 30000) {
    notes.push(`Latência alta: p95 ${Math.round(d.latency.p95Ms / 1000)}s em ${d.latency.count} turnos.`)
  }
  const usedFeatures = Object.keys(d.featureUsage).length
  if (usedFeatures > 0) {
    const top = Object.entries(d.featureUsage).sort((a, b) => b[1] - a[1])[0]
    notes.push(`Feature mais usada: "${top[0]}" (${top[1]}×).`)
  }
  const topTool = Object.entries(d.toolUsage).sort((a, b) => b[1] - a[1])[0]
  if (topTool && topTool[1] >= 3) {
    notes.push(`Tool mais usada: "${topTool[0]}" (${topTool[1]}×) — área de maior uso real.`)
  }
  return notes
}

/** Aggregate raw events into a small, readable digest over the last
 *  `windowDays`. Pure — `now` is injectable for tests. */
export function summarizeInsights(
  events: InsightEvent[],
  windowDays = 30,
  now: number = Date.now(),
): InsightsDigest {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000
  const recent = events.filter((e) => e.t >= cutoff)

  const errorsByKind: Record<string, number> = {}
  const featureUsage: Record<string, number> = {}
  const toolUsage: Record<string, number> = {}
  const providerMix: Record<string, number> = {}
  const modelMix: Record<string, number> = {}
  const versionMix: Record<string, number> = {}
  const friction = { circuitBreaks: 0, retries: 0, toolDenials: 0, emptyReplies: 0, contextCompactions: 0 }
  const latencies: number[] = []
  // turnos com id → ciclo de vida; sem id (eventos legados) → só contagens.
  const turnMap = new Map<string, { startT: number; outcome: string | null }>()
  let turnsStarted = 0
  const legacyOutcomes: string[] = []
  const streamShare = { samples: 0, waitMs: 0, reasoningMs: 0, toolMs: 0, contentMs: 0, longToolAssemblies: 0 }

  for (const e of recent) {
    switch (e.c) {
      case 'error':
        bump(errorsByKind, e.a)
        break
      case 'feature':
        if (e.a === 'open') bump(featureUsage, String(e.m?.feature ?? 'unknown'))
        break
      case 'chat':
        if (e.a === 'turn') {
          turnsStarted++
          bump(providerMix, String(e.m?.provider ?? 'unknown'))
          bump(modelMix, String(e.m?.model ?? 'unknown'))
          if (typeof e.m?.v === 'string') bump(versionMix, e.m.v)
          if (typeof e.m?.turn === 'string') turnMap.set(e.m.turn, { startT: e.t, outcome: null })
        } else if (e.a === 'retry') friction.retries++
        else if (e.a === 'empty_reply') friction.emptyReplies++
        else if (e.a === 'complete') {
          if (typeof e.m?.ms === 'number') latencies.push(e.m.ms)
          const outcome = typeof e.m?.outcome === 'string' ? e.m.outcome : 'ok'
          const id = typeof e.m?.turn === 'string' ? e.m.turn : null
          const tracked = id ? turnMap.get(id) : undefined
          if (tracked) tracked.outcome = outcome
          else legacyOutcomes.push(outcome) // legado ou início fora da janela
        } else if (e.a === 'stream_profile') {
          streamShare.samples++
          for (const k of ['waitMs', 'reasoningMs', 'toolMs', 'contentMs'] as const) {
            if (typeof e.m?.[k] === 'number') streamShare[k] += e.m[k] as number
          }
          if (typeof e.m?.toolMs === 'number' && e.m.toolMs >= LONG_TOOL_ASSEMBLY_MS) streamShare.longToolAssemblies++
        }
        break
      case 'tool':
        if (e.a === 'use') bump(toolUsage, String(e.m?.name ?? 'unknown'))
        else if (e.a === 'denied') friction.toolDenials++
        break
      case 'agent':
        if (e.a === 'circuit_break') friction.circuitBreaks++
        break
      case 'context':
        if (e.a === 'compaction') friction.contextCompactions++
        break
    }
  }

  // Desfechos: turnos rastreados por id + contagens legadas (sem id).
  const turns = { started: turnsStarted, completed: 0, aborted: 0, errored: 0, zombies: 0 }
  const countOutcome = (o: string) => {
    if (o === 'aborted') turns.aborted++
    else if (o === 'error') turns.errored++
    else turns.completed++
  }
  const lastStartT = Math.max(0, ...[...turnMap.values()].map(t => t.startT))
  for (const t of turnMap.values()) {
    if (t.outcome) countOutcome(t.outcome)
    // Sem desfecho: zumbi se um turno mais novo existe (o app roda um por
    // vez — turno novo prova que este morreu) ou se já passou da idade.
    else if (t.startT < lastStartT || now - t.startT > ZOMBIE_AGE_MS) turns.zombies++
  }
  for (const o of legacyOutcomes) countOutcome(o)

  const base = {
    generatedAt: now,
    windowDays,
    totalEvents: recent.length,
    errorsByKind,
    featureUsage,
    toolUsage,
    providerMix,
    modelMix,
    friction,
    latency: computeLatency(latencies),
    turns,
    streamShare,
    versionMix,
  }
  return { ...base, notes: buildNotes(base) }
}

function computeLatency(ms: number[]): InsightsDigest['latency'] {
  if (ms.length === 0) return { count: 0, avgMs: 0, p95Ms: 0 }
  const sorted = [...ms].sort((a, b) => a - b)
  const avgMs = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
  const p95Ms = sorted[Math.floor(0.95 * (sorted.length - 1))]
  return { count: sorted.length, avgMs, p95Ms }
}

/** Render a digest as a readable Markdown report — used by the in-app
 *  "Export .md" button and shareable as-is. Pure. */
export function formatInsightsReport(d: InsightsDigest): string {
  const lines: string[] = [
    `# Dev Insights — OpenClaude Desktop`,
    ``,
    `Gerado: ${new Date(d.generatedAt).toISOString()} · Janela: ${d.windowDays} dias · Eventos: ${d.totalEvents}`,
    ``,
  ]
  const section = (title: string, rec: Record<string, number>) => {
    const entries = Object.entries(rec).sort((a, b) => b[1] - a[1])
    if (entries.length === 0) return
    lines.push(`## ${title}`)
    for (const [k, v] of entries) lines.push(`- ${k}: ${v}`)
    lines.push(``)
  }
  if (d.turns.started > 0) {
    lines.push(
      `## Turnos`,
      `- iniciados: ${d.turns.started} · completos: ${d.turns.completed} · abortados: ${d.turns.aborted} · com erro: ${d.turns.errored} · zumbis: ${d.turns.zombies}`,
      ``,
    )
  }
  if (d.streamShare.samples > 0) {
    const s = d.streamShare
    const total = s.waitMs + s.reasoningMs + s.toolMs + s.contentMs
    const pct = (ms: number) => total > 0 ? `${Math.round((ms / total) * 100)}%` : '0%'
    lines.push(
      `## Perfil de geração (onde foi o tempo)`,
      `- amostras: ${s.samples} · espera 1º token: ${pct(s.waitMs)} · raciocínio: ${pct(s.reasoningMs)} · montagem de tool: ${pct(s.toolMs)} · texto: ${pct(s.contentMs)}`,
      `- montagens de tool com 5+ min: ${s.longToolAssemblies}`,
      ``,
    )
  }
  section('Erros por categoria', d.errorsByKind)
  section('Uso de features', d.featureUsage)
  section('Uso de tools', d.toolUsage)
  section('Provedores', d.providerMix)
  section('Modelos', d.modelMix)
  section('Versões', d.versionMix)
  lines.push(
    `## Atrito`,
    `- circuit-breaks: ${d.friction.circuitBreaks}`,
    `- retries: ${d.friction.retries}`,
    `- tools negadas: ${d.friction.toolDenials}`,
    `- respostas vazias: ${d.friction.emptyReplies}`,
    `- compactações de contexto: ${d.friction.contextCompactions}`,
    ``,
  )
  if (d.latency.count > 0) {
    lines.push(`## Latência`, `- amostras: ${d.latency.count} · média: ${d.latency.avgMs}ms · p95: ${d.latency.p95Ms}ms`, ``)
  }
  if (d.notes.length) {
    lines.push(`## Notas`)
    for (const n of d.notes) lines.push(`- ${n}`)
    lines.push(``)
  }
  return lines.join('\n')
}
