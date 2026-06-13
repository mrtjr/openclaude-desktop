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
    /** write_file reescrevendo arquivo EXISTENTE grande (anti-padrão; era
     *  para ser edit_file) — v2.19.0. */
    rewriteExisting: number
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
  /** Comparativo entre as duas versões mais recentes com amostra suficiente
   *  (v2.15.0) — "o que mudou desde a release anterior". Null sem dados. */
  comparison: VersionComparison | null
  /** Achados estruturados ranqueados por impacto (v2.16.0) — substituem as
   *  notas de threshold fixo como fonte; `notes` é derivado deles. */
  findings: Finding[]
  /** Renderização em texto dos findings (compatibilidade + leitura rápida). */
  notes: string[]
}

// ─── Motor de findings (v2.16.0) ────────────────────────────────────
//
// As notas eram frases de threshold fixo, sempre iguais e sem hierarquia.
// Um finding é estruturado: severidade + evidência (os números que o
// sustentam — achado sem evidência não entra) + recomendação acionável +
// score de impacto para ranquear. O maintainer lê os 3 primeiros e já sabe
// o que atacar no ciclo; a UI pinta por severidade.

export type FindingSeverity = 'critical' | 'warning' | 'info'

/** Seletor de drill-down (v2.17.0): descreve quais eventos sustentam um
 *  achado, para o painel abrir a timeline por trás do número. */
export type DrillSelector =
  | { type: 'errors'; kind?: string; v?: string }
  | { type: 'zombie-turns' }
  | { type: 'action'; c: InsightCategory; a: string }
  | { type: 'tool'; name: string }
  | { type: 'feature'; name: string }
  | { type: 'long-tool-assemblies' }
  | { type: 'turn'; id: string }

export interface Finding {
  /** Chave estável do tipo de achado (ex.: 'zombie-turns', 'error-regression'). */
  id: string
  severity: FindingSeverity
  title: string
  /** Números que sustentam o achado. */
  evidence: string
  /** Próximo passo acionável. */
  recommendation: string
  /** Ranking de impacto (maior = mais urgente). */
  score: number
  /** Quando presente, o painel permite abrir os eventos por trás do achado. */
  drill?: DrillSelector
}

/** Resolve um seletor de drill-down para os eventos que o sustentam —
 *  mais novos primeiro, limitado a `cap`. Pure (`now` injetável). */
export function drillEvents(
  events: InsightEvent[],
  sel: DrillSelector,
  now: number = Date.now(),
  cap = 50,
): InsightEvent[] {
  let match: (e: InsightEvent) => boolean
  switch (sel.type) {
    case 'errors':
      match = (e) => e.c === 'error'
        && (sel.kind === undefined || e.a === sel.kind)
        && (sel.v === undefined || e.m?.v === sel.v)
      break
    case 'action':
      match = (e) => e.c === sel.c && e.a === sel.a
      break
    case 'tool':
      match = (e) => e.c === 'tool' && e.a === 'use' && e.m?.name === sel.name
      break
    case 'feature':
      match = (e) => e.c === 'feature' && e.a === 'open' && e.m?.feature === sel.name
      break
    case 'long-tool-assemblies':
      match = (e) => e.c === 'chat' && e.a === 'stream_profile'
        && typeof e.m?.toolMs === 'number' && e.m.toolMs >= LONG_TOOL_ASSEMBLY_MS
      break
    case 'turn':
      // Timeline completa do turno: tudo que ele fez, em ordem.
      match = (e) => e.m?.turn === sel.id
      break
    case 'zombie-turns': {
      // Mesma semântica do digest: turno com id, sem complete, e (turno mais
      // novo existe OU passou da idade).
      const completedIds = new Set<string>()
      let lastTurnStartT = 0
      for (const e of events) {
        if (e.c !== 'chat') continue
        if (e.a === 'complete' && typeof e.m?.turn === 'string') completedIds.add(e.m.turn)
        else if (e.a === 'turn' && e.t > lastTurnStartT) lastTurnStartT = e.t
      }
      match = (e) => e.c === 'chat' && e.a === 'turn'
        && typeof e.m?.turn === 'string' && !completedIds.has(e.m.turn)
        && (e.t < lastTurnStartT || now - e.t > ZOMBIE_AGE_MS)
      break
    }
  }
  return events.filter(match).sort((a, b) => b.t - a.t).slice(0, cap)
}

const SEVERITY_BASE: Record<FindingSeverity, number> = { critical: 100, warning: 50, info: 10 }

/** Recomendação específica por categoria de erro (classifyProviderError). */
const ERROR_KIND_RECOMMENDATION: Record<string, string> = {
  timeout: 'Rever budgets de timeout e watchdog do provider (provider-timeouts.js).',
  auth: 'Chave de API inválida ou expirada — revisar credenciais nas configurações.',
  rate_limit: 'Provider limitando chamadas — espaçar requisições ou revisar plano.',
  overloaded: 'Provider sobrecarregado — o retry já cobre; considerar fallback de modelo.',
  network: 'Instabilidade de rede entre o app e o provider.',
  context: 'Pressão de contexto — revisar compactação e limite do modelo.',
  not_found: 'Modelo ou endpoint inexistente — revisar a configuração do provider.',
  unknown: 'Categoria dominante é "unknown" — melhorar a classificação em providerErrors.ts para diagnósticos futuros.',
}

// ─── Comparativo entre versões (v2.15.0) ────────────────────────────
//
// "O que mudou desde a versão anterior?" — métricas NORMALIZADAS POR TURNO
// (o volume de uso difere entre versões; contagens absolutas enganam),
// segmentadas pelo `m.v` que todo evento carrega desde a v2.14.0. Eventos
// legados sem versão caem no balde 'pré-2.14.0', dando baseline imediato.
// Sem persistência extra: é função pura sobre os mesmos eventos do digest.

export interface VersionMetrics {
  v: string
  turns: number
  errors: number
  /** Erros por turno (um turno pode logar mais de um erro). */
  errorRate: number
  zombies: number
  zombieRate: number
  aborted: number
  retries: number
  retryRate: number
  avgLatencyMs: number
  /** % do tempo de geração em montagem de tool / raciocínio (stream_profile). */
  toolSharePct: number
  reasoningSharePct: number
  errorsByKind: Record<string, number>
}

export interface VersionComparison {
  /** As DUAS versões mais recentes (por último evento) com ≥3 turnos cada. */
  current: VersionMetrics
  previous: VersionMetrics
  /** Tipos de erro que estrearam na atual / sumiram desde a anterior. */
  newErrorKinds: string[]
  resolvedErrorKinds: string[]
}

const MIN_TURNS_FOR_COMPARISON = 3
const LEGACY_VERSION_LABEL = 'pré-2.14.0'

export function compareVersionSegments(events: InsightEvent[], now: number): VersionComparison | null {
  const vOf = (e: InsightEvent) => (typeof e.m?.v === 'string' ? e.m.v : LEGACY_VERSION_LABEL)

  // Ordena versões por último evento visto (a "atual" é a mais recente).
  const lastSeen = new Map<string, number>()
  for (const e of events) {
    const v = vOf(e)
    if (e.t > (lastSeen.get(v) ?? 0)) lastSeen.set(v, e.t)
  }
  if (lastSeen.size < 2) return null
  const ordered = [...lastSeen.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)

  // Estado global para zumbis: completes por id e o início de turno mais novo
  // (um turno novo prova que o anterior sem desfecho morreu — app serial).
  const completedIds = new Set<string>()
  let lastTurnStartT = 0
  for (const e of events) {
    if (e.c !== 'chat') continue
    if (e.a === 'complete' && typeof e.m?.turn === 'string') completedIds.add(e.m.turn)
    else if (e.a === 'turn' && e.t > lastTurnStartT) lastTurnStartT = e.t
  }

  const metricsFor = (v: string): VersionMetrics => {
    let turns = 0, errors = 0, zombies = 0, aborted = 0, retries = 0
    const lat: number[] = []
    const share = { reasoningMs: 0, toolMs: 0, contentMs: 0 }
    const errorsByKind: Record<string, number> = {}
    for (const e of events) {
      if (vOf(e) !== v) continue
      if (e.c === 'error') {
        errors++
        bump(errorsByKind, e.a)
      } else if (e.c === 'chat') {
        if (e.a === 'turn') {
          turns++
          const id = typeof e.m?.turn === 'string' ? e.m.turn : null
          if (id && !completedIds.has(id) && (e.t < lastTurnStartT || now - e.t > ZOMBIE_AGE_MS)) zombies++
        } else if (e.a === 'retry') retries++
        else if (e.a === 'complete') {
          if (typeof e.m?.ms === 'number') lat.push(e.m.ms)
          if (e.m?.outcome === 'aborted') aborted++
        } else if (e.a === 'stream_profile') {
          for (const k of ['reasoningMs', 'toolMs', 'contentMs'] as const) {
            if (typeof e.m?.[k] === 'number') share[k] += e.m[k] as number
          }
        }
      }
    }
    const gen = share.reasoningMs + share.toolMs + share.contentMs
    const per = (n: number) => (turns > 0 ? Math.round((n / turns) * 100) / 100 : 0)
    return {
      v, turns, errors, errorRate: per(errors), zombies, zombieRate: per(zombies),
      aborted, retries, retryRate: per(retries),
      avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
      toolSharePct: gen > 0 ? Math.round((share.toolMs / gen) * 100) : 0,
      reasoningSharePct: gen > 0 ? Math.round((share.reasoningMs / gen) * 100) : 0,
      errorsByKind,
    }
  }

  // Par mais recente com amostra mínima — taxa sobre 1–2 turnos engana.
  const eligible = ordered.map(metricsFor).filter(m => m.turns >= MIN_TURNS_FOR_COMPARISON)
  if (eligible.length < 2) return null
  const [current, previous] = eligible
  const newErrorKinds = Object.keys(current.errorsByKind).filter(k => !(k in previous.errorsByKind))
  const resolvedErrorKinds = Object.keys(previous.errorsByKind).filter(k => !(k in current.errorsByKind))
  return { current, previous, newErrorKinds, resolvedErrorKinds }
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

export function buildFindings(d: Omit<InsightsDigest, 'notes' | 'findings'>): Finding[] {
  const findings: Finding[] = []
  const add = (id: string, severity: FindingSeverity, title: string, evidence: string, recommendation: string, bonus = 0, drill?: DrillSelector) =>
    findings.push({ id, severity, title, evidence, recommendation, score: SEVERITY_BASE[severity] + bonus, ...(drill ? { drill } : {}) })

  // ── Críticos ──
  if (d.turns.zombies > 0) {
    add('zombie-turns', 'critical', 'Turnos zumbis',
      `${d.turns.zombies} turno(s) zumbi — começaram e nunca registraram desfecho`,
      'Investigar stream preso, crash ou app fechado no meio — conferir watchdog e logs do main.',
      d.turns.zombies * 5, { type: 'zombie-turns' })
  }
  if (d.comparison) {
    const { current: cur, previous: prev, newErrorKinds, resolvedErrorKinds } = d.comparison
    if (cur.errors >= 2 && cur.errorRate >= prev.errorRate * 1.5 && prev.turns >= MIN_TURNS_FOR_COMPARISON && prev.errorRate > 0) {
      add('error-regression', 'critical', `Possível regressão na ${cur.v}`,
        `taxa de erro subiu de ${prev.errorRate} para ${cur.errorRate}/turno vs ${prev.v}`,
        `Revisar o que mudou na ${cur.v}; começar pelos erros novos se houver.`,
        20, { type: 'errors', v: cur.v })
    }
    if (newErrorKinds.length > 0) {
      add('new-error-kinds', 'warning', `Erro(s) novo(s) na ${cur.v}`,
        `${newErrorKinds.join(', ')} — não existiam na ${prev.v}`,
        `Conferir as mudanças da ${cur.v} relacionadas a essas categorias.`,
        newErrorKinds.length * 5, { type: 'errors', v: cur.v })
    }
    if (prev.errorRate > 0 && cur.errorRate <= prev.errorRate * 0.5) {
      add('error-improvement', 'info', `Melhora desde a ${prev.v}`,
        `taxa de erro caiu de ${prev.errorRate} para ${cur.errorRate}/turno na ${cur.v}`,
        'O ciclo funcionou — confirmar a tendência no próximo digest.')
    }
    if (resolvedErrorKinds.length > 0) {
      add('resolved-error-kinds', 'info', `Resolvido(s) desde a ${prev.v}`,
        `${resolvedErrorKinds.join(', ')} — sumiram na ${cur.v}`,
        'Nada a fazer; registrar como ganho do ciclo.')
    }
    if (prev.zombies > 0 && cur.zombies === 0) {
      add('zombies-zeroed', 'info', `Zumbis zerados na ${cur.v}`,
        `eram ${prev.zombies} na ${prev.v}`,
        'Nada a fazer; monitorar.')
    }
  }

  // ── Avisos ──
  const gen = d.streamShare.reasoningMs + d.streamShare.toolMs + d.streamShare.contentMs
  if (d.streamShare.samples >= 3 && gen > 0) {
    const toolPct = Math.round((d.streamShare.toolMs / gen) * 100)
    const reasonPct = Math.round((d.streamShare.reasoningMs / gen) * 100)
    if (toolPct >= 40) {
      add('tool-assembly-dominant', 'warning', 'Montagem de tool call domina a geração',
        `montagem de tool call consome ${toolPct}% do tempo de geração (${d.streamShare.samples} amostras)`,
        'Candidata: tool de edição por trecho em vez de write_file inteiro.',
        toolPct - 40, { type: 'action', c: 'chat', a: 'stream_profile' })
    }
    if (reasonPct >= 50) {
      add('reasoning-dominant', 'warning', 'Raciocínio domina a geração',
        `raciocínio consome ${reasonPct}% do tempo de geração`,
        'Avaliar limite de thinking ou modelo mais direto para tarefas simples.',
        reasonPct - 50, { type: 'action', c: 'chat', a: 'stream_profile' })
    }
  }
  if (d.streamShare.longToolAssemblies >= 2) {
    add('long-tool-assemblies', 'warning', 'Montagens de tool call muito longas',
      `${d.streamShare.longToolAssemblies} passo(s) com 5+ min só montando tool call`,
      'Turnos "parados" que parecem travamento — reforça a tool de edição por trecho.',
      d.streamShare.longToolAssemblies * 3, { type: 'long-tool-assemblies' })
  }
  const topError = Object.entries(d.errorsByKind).sort((a, b) => b[1] - a[1])[0]
  if (topError && topError[1] >= 3) {
    add('frequent-error', 'warning', `Erro mais frequente: "${topError[0]}"`,
      `${topError[1]}× na janela`,
      ERROR_KIND_RECOMMENDATION[topError[0]] ?? 'Investigar a categoria — bom candidato a próximo ciclo.',
      topError[1] * 2, { type: 'errors', kind: topError[0] })
  }
  if (d.friction.rewriteExisting >= 3) {
    add('prefer-edit-file', 'warning', 'write_file reescrevendo arquivos existentes',
      `${d.friction.rewriteExisting} reescritas totais de arquivos que já existiam`,
      'O modelo está ignorando edit_file — conferir o steering do prompt e se as tentativas de edit_file falham.',
      d.friction.rewriteExisting * 2, { type: 'action', c: 'tool', a: 'rewrite_existing' })
  }
  if (d.friction.circuitBreaks >= 3) {
    add('circuit-breaks', 'warning', 'Circuit-breaks recorrentes',
      `${d.friction.circuitBreaks} disparos na janela`,
      'Possíveis loops de agente — revisar prompts/política dos casos que repetem.',
      d.friction.circuitBreaks, { type: 'action', c: 'agent', a: 'circuit_break' })
  }
  if (d.friction.emptyReplies >= 3) {
    add('empty-replies', 'warning', 'Respostas vazias frequentes',
      `${d.friction.emptyReplies} na janela`,
      'Modelo/provider problemático — cruzar com o mix de modelos.',
      d.friction.emptyReplies, { type: 'action', c: 'chat', a: 'empty_reply' })
  }

  // ── Informativos ──
  if (d.friction.contextCompactions >= 5) {
    add('context-pressure', 'info', 'Pressão de contexto alta',
      `${d.friction.contextCompactions} compactações na janela`,
      'Revisar limites de contexto do modelo ou a agressividade da compactação.',
      d.friction.contextCompactions, { type: 'action', c: 'context', a: 'compaction' })
  }
  if (d.friction.toolDenials >= 3) {
    add('tool-denials', 'info', 'Muitas tools negadas',
      `${d.friction.toolDenials} negações`,
      'Revisar gating/UX de permissão — atrito repetido vira abandono.',
      d.friction.toolDenials, { type: 'action', c: 'tool', a: 'denied' })
  }
  if (d.latency.count >= 5 && d.latency.p95Ms >= 30000) {
    add('high-latency', 'info', 'Latência alta',
      `p95 ${Math.round(d.latency.p95Ms / 1000)}s em ${d.latency.count} turnos`,
      'Cruzar com o perfil de geração para ver qual fase domina.',
      0, { type: 'action', c: 'chat', a: 'complete' })
  }
  const topFeature = Object.entries(d.featureUsage).sort((a, b) => b[1] - a[1])[0]
  if (topFeature) {
    add('top-feature', 'info', `Feature mais usada: "${topFeature[0]}"`,
      `${topFeature[1]}× na janela`,
      'Área de maior valor percebido — priorizar polimento aqui.',
      0, { type: 'feature', name: topFeature[0] })
  }
  const topTool = Object.entries(d.toolUsage).sort((a, b) => b[1] - a[1])[0]
  if (topTool && topTool[1] >= 3) {
    add('top-tool', 'info', `Tool mais usada: "${topTool[0]}"`,
      `${topTool[1]}× na janela`,
      'Área de maior uso real — otimizações aqui têm o maior alcance.',
      0, { type: 'tool', name: topTool[0] })
  }

  return findings.sort((a, b) => b.score - a.score)
}

/** Renderiza um finding como linha de texto (alimenta `notes` e o .md). */
export function renderFinding(f: Finding): string {
  return `${f.title} — ${f.evidence}. ${f.recommendation}`
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
  const friction = { circuitBreaks: 0, retries: 0, toolDenials: 0, emptyReplies: 0, contextCompactions: 0, rewriteExisting: 0 }
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
        else if (e.a === 'rewrite_existing') friction.rewriteExisting++
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
    comparison: compareVersionSegments(recent, now),
  }
  const findings = buildFindings(base)
  return { ...base, findings, notes: findings.map(renderFinding) }
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
  if (d.comparison) {
    const { current: cur, previous: prev, newErrorKinds, resolvedErrorKinds } = d.comparison
    const row = (label: string, before: number | string, after: number | string, unit = '') =>
      `- ${label}: ${before}${unit} → ${after}${unit}`
    lines.push(
      `## O que mudou (${prev.v} → ${cur.v})`,
      `- turnos na amostra: ${prev.turns} → ${cur.turns}`,
      row('erros/turno', prev.errorRate, cur.errorRate),
      row('zumbis/turno', prev.zombieRate, cur.zombieRate),
      row('retries/turno', prev.retryRate, cur.retryRate),
      row('latência média', prev.avgLatencyMs, cur.avgLatencyMs, 'ms'),
      row('montagem de tool', prev.toolSharePct, cur.toolSharePct, '%'),
      row('raciocínio', prev.reasoningSharePct, cur.reasoningSharePct, '%'),
    )
    if (newErrorKinds.length) lines.push(`- erros novos: ${newErrorKinds.join(', ')}`)
    if (resolvedErrorKinds.length) lines.push(`- erros resolvidos: ${resolvedErrorKinds.join(', ')}`)
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
    `- reescritas de arquivo existente (era p/ ser edit_file): ${d.friction.rewriteExisting}`,
    ``,
  )
  if (d.latency.count > 0) {
    lines.push(`## Latência`, `- amostras: ${d.latency.count} · média: ${d.latency.avgMs}ms · p95: ${d.latency.p95Ms}ms`, ``)
  }
  if (d.findings.length) {
    const icon: Record<FindingSeverity, string> = { critical: '🔴', warning: '🟡', info: '🔵' }
    lines.push(`## Achados (por impacto)`)
    for (const f of d.findings) lines.push(`- ${icon[f.severity]} ${renderFinding(f)}`)
    lines.push(``)
  }
  return lines.join('\n')
}
