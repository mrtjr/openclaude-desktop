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
  /** Auto-generated, human/AI-readable prioritisation hints. */
  notes: string[]
}

// ─── In-memory buffer ───────────────────────────────────────────────
const buffer: InsightEvent[] = []
let enabled = true

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
  buffer.push({ t: Date.now(), c: category, a: String(action), m: sanitizeMeta(meta) })
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
  const friction = { circuitBreaks: 0, retries: 0, toolDenials: 0, emptyReplies: 0, contextCompactions: 0 }
  const latencies: number[] = []

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
          bump(providerMix, String(e.m?.provider ?? 'unknown'))
          bump(modelMix, String(e.m?.model ?? 'unknown'))
        } else if (e.a === 'retry') friction.retries++
        else if (e.a === 'empty_reply') friction.emptyReplies++
        else if (e.a === 'complete' && typeof e.m?.ms === 'number') latencies.push(e.m.ms)
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
  section('Erros por categoria', d.errorsByKind)
  section('Uso de features', d.featureUsage)
  section('Uso de tools', d.toolUsage)
  section('Provedores', d.providerMix)
  section('Modelos', d.modelMix)
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
