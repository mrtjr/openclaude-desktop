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

export type InsightCategory = 'chat' | 'error' | 'tool' | 'feature' | 'context' | 'provider' | 'agent' | 'skill'

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
  /** Falhas por ferramenta (v2.108.0): o `ok:false` de cada tool/use, antes
   *  descartado. Cruzado com toolUsage dá a TAXA de falha — "tool X falha Y%". */
  toolFailures: Record<string, number>
  providerMix: Record<string, number>
  modelMix: Record<string, number>
  /** Métricas SEGMENTADAS por modelo (v2.108.0): latência e erro por modelo, em
   *  vez de só números globais — responde "qual modelo está lento/falhando". */
  byModel: Record<string, ModelStats>
  /** Auto-monitoramento (v2.108.0): a própria telemetria denuncia seus buracos
   *  (eventos sem modelo/tool, turnos sem perfil de geração). */
  dataQuality: { unknownModelRate: number; unknownToolRate: number; profileCoverage: number }
  /** Qualidade do turno (v2.109.0): proxies de (in)satisfação. regenerated e
   *  quickFollowups = sinais NEGATIVOS (resposta não serviu); copies = POSITIVO
   *  (usuário levou a saída). */
  turnQuality: { regenerated: number; quickFollowups: number; copies: number; branches: number }
  /** Carregamentos por skill (v2.109.0): o skill/load (logado desde a v2.106)
   *  finalmente agregado — quais skills são realmente usadas. */
  skillUsage: Record<string, number>
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
   *  longToolAssemblies conta passos com 5+ min só montando uma tool call.
   *  toolMsByName atribui o tempo de montagem à FERRAMENTA real (v2.20.0) —
   *  via join stream_profile↔tool/use por (turn,step); 'unattributed' para
   *  passos sem par 1:1. Antes o digest assumia write_file por engano. */
  streamShare: {
    samples: number; waitMs: number; reasoningMs: number; toolMs: number; contentMs: number
    longToolAssemblies: number
    toolMsByName: Record<string, number>
    /** Correlação espera↔execução local anterior (v2.21.0): a espera de 1º
     *  token é maior DEPOIS de uma execução de tool longa? Se sim, o container
     *  Modal esfria durante a execução local (cold-start client-fixable via
     *  keep-warm); se não, é idle puro do provider (server-side). */
    coldStart: {
      afterLong: { n: number; waitMs: number }   // passos após execução local longa
      afterShort: { n: number; waitMs: number }  // passos após execução curta/ausente
    }
  }
  /** Turnos por versão do app — mede o efeito de cada release. */
  versionMix: Record<string, number>
  /** Comparativo entre as duas versões mais recentes com amostra suficiente
   *  (v2.15.0) — "o que mudou desde a release anterior". Null sem dados. */
  comparison: VersionComparison | null
  /** Tendência DENTRO da janela (v2.110.0): 1ª metade vs 2ª metade — pega
   *  regressão/melhora gradual que o comparativo entre versões não vê. */
  trend: WindowTrend | null
  /** Achados estruturados ranqueados por impacto (v2.16.0) — substituem as
   *  notas de threshold fixo como fonte; `notes` é derivado deles. */
  findings: Finding[]
  /** O achado acionável de MAIOR impacto (v2.110.0): o 1º finding não-info já
   *  ranqueado por frequência×severidade. É o "faça isto a seguir" que o loop lê
   *  direto, sem reinterpretar a lista. Null se só houver informativos. */
  topPriority: Finding | null
  /** Renderização em texto dos findings (compatibilidade + leitura rápida). */
  notes: string[]
}

/** Tendência intra-janela (v2.110.0): métricas normalizadas por turno na 1ª vs
 *  2ª metade da janela, e quais pioraram/melhoraram. */
export interface TrendHalf {
  turns: number
  errorRate: number
  frictionRate: number
  dissatisfactionRate: number
  avgMs: number
}
export interface WindowTrend {
  firstHalf: TrendHalf
  secondHalf: TrendHalf
  worsening: { metric: string; from: number; to: number }[]
  improving: { metric: string; from: number; to: number }[]
}

// ─── Motor de findings (v2.16.0) ────────────────────────────────────
//
// As notas eram frases de threshold fixo, sempre iguais e sem hierarquia.
// Um finding é estruturado: severidade + evidência (os números que o
// sustentam — achado sem evidência não entra) + recomendação acionável +
// score de impacto para ranquear. O maintainer lê os 3 primeiros e já sabe
// o que atacar no ciclo; a UI pinta por severidade.

/** Métricas por modelo (v2.108.0). errorRate = erros/turno (um turno pode logar
 *  mais de um erro). */
export interface ModelStats {
  turns: number
  errors: number
  errorRate: number
  avgMs: number
  p95Ms: number
}

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
    const share = { waitMs: 0, reasoningMs: 0, toolMs: 0, contentMs: 0 }
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
          for (const k of ['waitMs', 'reasoningMs', 'toolMs', 'contentMs'] as const) {
            if (typeof e.m?.[k] === 'number') share[k] += e.m[k] as number
          }
        }
      }
    }
    // Denominador HONESTO (v2.20.0): inclui a espera de 1º token, igual ao
    // formatInsightsReport e ao painel — antes excluía waitMs e inflava o tool.
    const total = share.waitMs + share.reasoningMs + share.toolMs + share.contentMs
    const per = (n: number) => (turns > 0 ? Math.round((n / turns) * 100) / 100 : 0)
    return {
      v, turns, errors, errorRate: per(errors), zombies, zombieRate: per(zombies),
      aborted, retries, retryRate: per(retries),
      avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
      toolSharePct: total > 0 ? Math.round((share.toolMs / total) * 100) : 0,
      reasoningSharePct: total > 0 ? Math.round((share.reasoningMs / total) * 100) : 0,
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

// ─── Tendência intra-janela (v2.110.0) ──────────────────────────────
// O comparativo entre versões só dispara quando há 2 versões com amostra. Mas
// um problema pode crescer DENTRO da mesma versão/janela (degradação gradual,
// drift). Aqui partimos a janela ao meio e comparamos as taxas por turno — pega
// a regressão antes de virar crítica. Pura (midpoint injetável).

const TREND_MIN_TURNS = 3

export function computeWindowTrend(recent: InsightEvent[], midpointT: number): WindowTrend | null {
  const half = (inHalf: (t: number) => boolean): TrendHalf => {
    let turns = 0, errors = 0, friction = 0, dissat = 0
    const lat: number[] = []
    for (const e of recent) {
      if (!inHalf(e.t)) continue
      if (e.c === 'error') errors++
      else if (e.c === 'agent' && e.a === 'circuit_break') friction++
      else if (e.c === 'chat') {
        if (e.a === 'turn') turns++
        else if (e.a === 'retry' || e.a === 'empty_reply') friction++
        else if (e.a === 'regenerate' || e.a === 'quick_followup') dissat++
        else if (e.a === 'complete' && typeof e.m?.ms === 'number') lat.push(e.m.ms)
      }
    }
    const per = (n: number) => (turns > 0 ? Math.round((n / turns) * 100) / 100 : 0)
    const avgMs = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0
    return { turns, errorRate: per(errors), frictionRate: per(friction), dissatisfactionRate: per(dissat), avgMs }
  }
  const firstHalf = half((t) => t < midpointT)
  const secondHalf = half((t) => t >= midpointT)
  if (firstHalf.turns < TREND_MIN_TURNS || secondHalf.turns < TREND_MIN_TURNS) return null

  const worsening: WindowTrend['worsening'] = []
  const improving: WindowTrend['improving'] = []
  const cmpRate = (metric: string, from: number, to: number) => {
    if (to >= from * 1.5 && to - from >= 0.1) worsening.push({ metric, from, to })
    else if (from > 0 && to <= from * 0.5) improving.push({ metric, from, to })
  }
  cmpRate('erros/turno', firstHalf.errorRate, secondHalf.errorRate)
  cmpRate('atrito/turno', firstHalf.frictionRate, secondHalf.frictionRate)
  cmpRate('insatisfação/turno', firstHalf.dissatisfactionRate, secondHalf.dissatisfactionRate)
  // Latência: limiar relativo + absoluto (2s) para não disparar por ruído.
  if (firstHalf.avgMs > 0 && secondHalf.avgMs >= firstHalf.avgMs * 1.5 && secondHalf.avgMs - firstHalf.avgMs >= 2000) {
    worsening.push({ metric: 'latência média', from: firstHalf.avgMs, to: secondHalf.avgMs })
  } else if (secondHalf.avgMs > 0 && firstHalf.avgMs >= secondHalf.avgMs * 1.5) {
    improving.push({ metric: 'latência média', from: firstHalf.avgMs, to: secondHalf.avgMs })
  }
  return { firstHalf, secondHalf, worsening, improving }
}

// Turno mais recente sem desfecho só vira zumbi depois desta idade (pode
// ainda estar rodando); os anteriores ao último turno são zumbis na hora —
// o app roda um turno por vez (sendingRef), então um novo turno prova que
// o anterior morreu sem registrar desfecho.
const ZOMBIE_AGE_MS = 2 * 60 * 60 * 1000
const LONG_TOOL_ASSEMBLY_MS = 5 * 60 * 1000
// Execução local (tool) acima disto provavelmente deixou o container Modal
// esfriar — usado para correlacionar com a espera do passo seguinte (v2.21.0).
const LONG_LOCAL_EXEC_MS = 30 * 1000

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

/** Se um turno ainda está ATIVO (sem 'complete') quando o app fecha/recarrega,
 *  registra um 'complete' sintético (outcome 'aborted', reason 'app_closed')
 *  ANTES do flush final — senão o turno vira "zumbi" no digest. Importante: um
 *  CRASH real (renderer morto) NÃO dispara beforeunload, então não passa por
 *  aqui e segue zumbi — exatamente o sinal que vale investigar. Chamado pelo
 *  useDevInsights no beforeunload, antes de persistir. Turnos de 8+ min (cold
 *  start do GLM) fechados no meio eram a maior fonte de falsos zumbis. */
export function flushInterruptedTurn(): void {
  if (!turnCtx) return
  logInsight('chat', 'complete', { outcome: 'aborted', reason: 'app_closed' })
  endInsightTurn()
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

/** Soma um valor arbitrário (não só +1) — usado para agregar ms por tool. */
function bump2(rec: Record<string, number>, key: string, amount: number): void {
  rec[key] = (rec[key] || 0) + amount
}

/** Ferramenta que mais consumiu tempo de montagem. Ignora 'unattributed' na
 *  escolha do nome (mas ele entra no total para honestidade). Null se vazio. */
function dominantAssemblyTool(byName: Record<string, number>): { name: string; ms: number } | null {
  let best: { name: string; ms: number } | null = null
  for (const [name, ms] of Object.entries(byName)) {
    if (name === 'unattributed') continue
    if (!best || ms > best.ms) best = { name, ms }
  }
  return best
}

export function buildFindings(d: Omit<InsightsDigest, 'notes' | 'findings' | 'topPriority'>): Finding[] {
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
  // Tendência intra-janela (v2.110.0): uma métrica subindo na 2ª metade da
  // janela é regressão em formação — pega antes de virar crítica, mesmo dentro
  // da mesma versão. Reporta a pior; melhora vira informativo.
  if (d.trend?.worsening.length) {
    const w = [...d.trend.worsening].sort((a, b) => (b.to - b.from) - (a.to - a.from))[0]
    const isLat = w.metric.startsWith('latência')
    const fmt = (n: number) => isLat ? `${Math.round(n / 1000)}s` : `${n}`
    add('trend-worsening', 'warning', `Piora em formação: ${w.metric}`,
      `${w.metric} subiu de ${fmt(w.from)} para ${fmt(w.to)} entre a 1ª e a 2ª metade da janela`,
      'Regressão gradual (mesma versão ou drift). Investigar o que mudou no período antes de virar crítico.',
      Math.round((w.to - w.from) * (isLat ? 0.005 : 15)), { type: 'action', c: 'chat', a: 'turn' })
  } else if (d.trend?.improving.length) {
    const i = d.trend.improving[0]
    add('trend-improving', 'info', `Melhora em curso: ${i.metric}`,
      `${i.metric} caiu na 2ª metade da janela`,
      'Tendência boa — confirmar no próximo digest.')
  }

  // ── Perfil de geração (v2.20.0: denominador HONESTO inclui a espera) ──
  // Antes o share era calculado sobre gen = reasoning+tool+content, EXCLUINDO
  // waitMs — isso escondia que a espera de 1º token (cold start) costuma ser
  // o MAIOR sorvedouro absoluto de wall-clock. Agora rankeamos sobre o total.
  const s = d.streamShare
  const total = s.waitMs + s.reasoningMs + s.toolMs + s.contentMs
  if (s.samples >= 3 && total > 0) {
    const pct = (ms: number) => Math.round((ms / total) * 100)
    const waitPct = pct(s.waitMs)
    const toolPct = pct(s.toolMs)
    const reasonPct = pct(s.reasoningMs)
    const waitIsTop = s.waitMs >= s.toolMs && s.waitMs >= s.reasoningMs && s.waitMs >= s.contentMs
    // Cold-start: maior fatia E pelo menos 40% do wall-clock → crítico.
    if (waitIsTop && waitPct >= 40) {
      add('cold-start-wait-dominant', 'critical', 'Espera de 1º token domina o tempo (cold start)',
        `espera pelo 1º token = ${waitPct}% do wall-clock de stream (${Math.round(s.waitMs / 1000)}s em ${s.samples} amostras) — maior fatia, acima da montagem de tool (${toolPct}%)`,
        'Cold start de GPU do Modal. Fix server-side no endpoint: min_containers=1 (mantém 1 container quente) e/ou aumentar scaledown_window/container_idle_timeout para não desligar entre passos. Custo: 1 GPU ociosa. Ver também o achado cold-start-after-local-exec para saber se parte é client-fixable.',
        waitPct, { type: 'action', c: 'chat', a: 'stream_profile' })
    }
    // v2.21.0: a espera cresce DEPOIS de execução local longa? Então o container
    // esfria DURANTE a execução de tools — parte do cold start é client-fixable
    // (keep-warm durante a execução). Bifurcação limpa, ao contrário da montagem.
    const cs = s.coldStart
    if (cs.afterLong.n >= 2 && cs.afterShort.n >= 2) {
      const avgLong = Math.round(cs.afterLong.waitMs / cs.afterLong.n / 1000)
      const avgShort = Math.round(cs.afterShort.waitMs / cs.afterShort.n / 1000)
      if (avgLong >= 20 && cs.afterLong.waitMs / cs.afterLong.n >= (cs.afterShort.waitMs / cs.afterShort.n) * 1.5) {
        add('cold-start-after-local-exec', 'critical', 'Cold start ligado à execução local (client-fixable)',
          `espera média ${avgLong}s após execução de tool longa vs ${avgShort}s após curta — o container Modal esfria DURANTE a execução local entre passos`,
          'Parte do cold start é client-fixable: manter o endpoint quente (keep-warm/ping leve) enquanto uma tool longa roda localmente, para o container não desligar antes do próximo passo. Validável — medir o efeito no próximo digest.',
          waitPct + 5, { type: 'action', c: 'chat', a: 'stream_profile' })
      } else {
        add('cold-start-provider-idle', 'info', 'Cold start independe da execução local',
          `espera média ${avgLong}s após execução longa ≈ ${avgShort}s após curta — não correlaciona com a execução local`,
          'Cold start é idle puro do Modal, não há gap local a fechar — fix é server-side (min_containers/scaledown_window).')
      }
    }
    // Montagem de tool relevante → nomear a FERRAMENTA real (não chutar write_file).
    if (toolPct >= 30) {
      const dom = dominantAssemblyTool(s.toolMsByName)
      const named = dom && dom.ms > 0 && dom.name !== 'unattributed'
      const sharePhrase = named
        ? `${dom.name} responde por ${Math.round((dom.ms / s.toolMs) * 100)}% da montagem`
        : 'montagem não atribuída a uma ferramenta única'
      add('tool-assembly-dominant', 'warning', 'Montagem de tool call pesa no tempo',
        `montagem de tool = ${toolPct}% do wall-clock; ${sharePhrase} (${s.samples} amostras${s.samples < 20 ? ', amostra pequena — direcional' : ''})`,
        // IMPORTANTE: mover o script para arquivo NÃO reduz o tempo — são os
        // mesmos tokens em write_file.content. Só MENOS tokens (comandos
        // menores; editar em vez de regenerar) ou provider mais rápido reduzem.
        named && dom.name === 'execute_command'
          ? 'O modelo gera argumentos gigantes no execute_command token-a-token. Mover para arquivo NÃO ajuda (mesmos tokens). Reduzir tempo só com MENOS tokens: comandos menores, ou editar conteúdo existente (edit_file) em vez de regenerá-lo. Caso contrário é limite de velocidade do provider.'
          : named
            ? `Reduzir o nº de tokens gerados como argumento para ${dom.name} (não realocá-los).`
            : 'Aumentar a amostra para atribuir a montagem a uma ferramenta específica antes de agir.',
        toolPct, { type: 'action', c: 'chat', a: 'stream_profile' })
    }
    if (reasonPct >= 40) {
      add('reasoning-dominant', 'warning', 'Raciocínio pesa no tempo',
        `raciocínio = ${reasonPct}% do wall-clock de stream`,
        'Avaliar limite de thinking ou modelo mais direto para tarefas simples.',
        reasonPct, { type: 'action', c: 'chat', a: 'stream_profile' })
    }
  }
  if (s.longToolAssemblies >= 2) {
    const dom = dominantAssemblyTool(s.toolMsByName)
    const who = dom && dom.name !== 'unattributed' ? ` (sobretudo ${dom.name})` : ''
    add('long-tool-assemblies', 'warning', 'Montagens de tool call muito longas',
      `${s.longToolAssemblies} passo(s) com 5+ min só montando uma tool call${who}`,
      'Turnos "parados" que parecem travamento. A redução só vem de gerar MENOS tokens (conteúdo menor; edit_file para editar em vez de regenerar) — realocar os mesmos tokens para outra ferramenta não muda o tempo.',
      s.longToolAssemblies * 3, { type: 'long-tool-assemblies' })
  }
  // Tool que mais FALHA (v2.108.0): cruza uso × ok:false. Prioriza pela
  // frequência da falha (rate × volume), não só a taxa — uma tool com 1 uso e
  // 1 falha (100%) não vale o mesmo que uma com 40 usos e 30% de falha.
  {
    const candidates = Object.entries(d.toolFailures)
      .map(([name, fails]) => ({ name, fails, uses: d.toolUsage[name] || fails, rate: fails / (d.toolUsage[name] || fails) }))
      .filter(c => c.uses >= 4 && c.rate >= 0.25)
      .sort((a, b) => b.fails - a.fails)
    if (candidates.length) {
      const c = candidates[0]
      add('failing-tool', 'warning', `Ferramenta com muita falha: "${c.name}"`,
        `${c.name} falhou ${c.fails}× em ${c.uses} usos (${Math.round(c.rate * 100)}%)`,
        `Investigar por que "${c.name}" falha tanto — é a tool com maior atrito real. Ver classificação de erro/args e o handler em useToolExecution.`,
        c.fails * 3, { type: 'tool', name: c.name })
    }
  }
  // Modelo que mais FALHA (v2.108.0): erro/turno segmentado por modelo.
  {
    const worst = Object.entries(d.byModel)
      .map(([model, st]) => ({ model, ...st }))
      .filter(m => m.model !== 'unknown' && m.turns >= 4 && m.errorRate >= 0.3)
      .sort((a, b) => b.errorRate - a.errorRate)[0]
    if (worst) {
      add('failing-model', 'warning', `Modelo com mais erros: "${worst.model}"`,
        `${worst.model}: ${worst.errors} erro(s) em ${worst.turns} turnos (${worst.errorRate}/turno)${worst.p95Ms ? `, p95 ${Math.round(worst.p95Ms / 1000)}s` : ''}`,
        'Cruzar com o provedor e considerar fallback/troca de modelo para essa fatia de uso.',
        Math.round(worst.errorRate * 10), { type: 'errors' })
    }
  }
  // (In)satisfação (v2.109.0): regenerações + re-perguntas rápidas sobre turnos
  // completos. Sinal direto de "a resposta não serviu" — antes invisível.
  {
    const completed = d.turns.completed
    const negative = d.turnQuality.regenerated + d.turnQuality.quickFollowups
    if (completed >= 5 && negative >= 3 && negative / completed >= 0.4) {
      add('low-satisfaction', 'warning', 'Sinais de insatisfação nas respostas',
        `${d.turnQuality.regenerated} regeneração(ões) + ${d.turnQuality.quickFollowups} re-pergunta(s) rápida(s) sobre ${completed} turnos completos (${Math.round((negative / completed) * 100)}%)`,
        'A resposta frequentemente não serve de primeira. Cruzar com modelo/tool dominante e revisar prompt/efeito; medir se cai no próximo digest.',
        Math.round((negative / completed) * 20), { type: 'action', c: 'chat', a: 'regenerate' })
    }
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
  // Auto-monitoramento (v2.108.0): a telemetria denuncia os próprios buracos —
  // sinal sem modelo/tool ou turnos sem perfil pioram TODAS as outras métricas.
  if (d.turns.started >= 5) {
    const q = d.dataQuality
    const issues: string[] = []
    if (q.unknownModelRate >= 0.2) issues.push(`${Math.round(q.unknownModelRate * 100)}% dos turnos sem modelo identificado`)
    if (q.unknownToolRate >= 0.2) issues.push(`${Math.round(q.unknownToolRate * 100)}% das tools sem nome`)
    if (q.profileCoverage < 0.5) issues.push(`só ${Math.round(q.profileCoverage * 100)}% dos turnos têm perfil de geração`)
    if (issues.length) {
      add('data-quality', 'info', 'Buracos na instrumentação',
        issues.join('; '),
        'Fechar os buracos de telemetria (anexar modelo/nome de tool/perfil) antes de confiar nas demais métricas — sinal cego enviesa o ranking.',
        0)
    }
  }
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
  // Skill mais carregada (v2.109.0): fecha o loop com o skill/load da v2.106.
  const topSkill = Object.entries(d.skillUsage).sort((a, b) => b[1] - a[1])[0]
  if (topSkill && topSkill[1] >= 2) {
    add('top-skill', 'info', `Skill mais usada: "${topSkill[0]}"`,
      `carregada ${topSkill[1]}× na janela`,
      'Skill de maior valor percebido — vale investir no playbook/exemplos dela.',
      0, { type: 'action', c: 'skill', a: 'load' })
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
  const toolFailures: Record<string, number> = {}
  const providerMix: Record<string, number> = {}
  const modelMix: Record<string, number> = {}
  const versionMix: Record<string, number> = {}
  // Segmentação por modelo (v2.108.0): turnos/erros/latências por modelo.
  const turnsByModel: Record<string, number> = {}
  const errorsByModel: Record<string, number> = {}
  const latByModel: Record<string, number[]> = {}
  const turnModel = new Map<string, string>()  // turnId → modelo (p/ joinar a latência)
  // Auto-monitoramento (v2.108.0): cobertura de instrumentação.
  let toolUsesTotal = 0, toolUsesUnknown = 0
  const turnsWithProfile = new Set<string>()
  const friction = { circuitBreaks: 0, retries: 0, toolDenials: 0, emptyReplies: 0, contextCompactions: 0, rewriteExisting: 0 }
  const turnQuality = { regenerated: 0, quickFollowups: 0, copies: 0, branches: 0 }
  const skillUsage: Record<string, number> = {}
  const latencies: number[] = []
  // turnos com id → ciclo de vida; sem id (eventos legados) → só contagens.
  const turnMap = new Map<string, { startT: number; outcome: string | null }>()
  let turnsStarted = 0
  const legacyOutcomes: string[] = []
  const streamShare = {
    samples: 0, waitMs: 0, reasoningMs: 0, toolMs: 0, contentMs: 0, longToolAssemblies: 0,
    toolMsByName: {} as Record<string, number>,
    coldStart: { afterLong: { n: 0, waitMs: 0 }, afterShort: { n: 0, waitMs: 0 } },
  }

  // Mapa (turn|step) → ferramentas usadas naquele passo, para atribuir o
  // toolMs de cada stream_profile à tool real (join por turn+step, ambos
  // auto-injetados em todo evento desde a v2.14.0). Passo com !=1 tool/use
  // cai em 'unattributed' — mais honesto que a média global anterior.
  const toolsByStep = new Map<string, string[]>()
  const stepKey = (turn: unknown, step: unknown) => `${turn ?? '?'}|${step ?? '?'}`
  for (const e of recent) {
    if (e.c === 'tool' && e.a === 'use' && typeof e.m?.turn === 'string') {
      const k = stepKey(e.m.turn, e.m.step)
      const arr = toolsByStep.get(k) || []
      arr.push(String(e.m?.name ?? 'unknown'))
      toolsByStep.set(k, arr)
    }
  }

  for (const e of recent) {
    switch (e.c) {
      case 'error':
        bump(errorsByKind, e.a)
        bump(errorsByModel, typeof e.m?.model === 'string' ? e.m.model : 'unknown')
        break
      case 'feature':
        if (e.a === 'open') bump(featureUsage, String(e.m?.feature ?? 'unknown'))
        break
      case 'chat':
        if (e.a === 'turn') {
          turnsStarted++
          const model = String(e.m?.model ?? 'unknown')
          bump(providerMix, String(e.m?.provider ?? 'unknown'))
          bump(modelMix, model)
          bump(turnsByModel, model)
          if (typeof e.m?.v === 'string') bump(versionMix, e.m.v)
          if (typeof e.m?.turn === 'string') { turnMap.set(e.m.turn, { startT: e.t, outcome: null }); turnModel.set(e.m.turn, model) }
        } else if (e.a === 'retry') friction.retries++
        else if (e.a === 'empty_reply') friction.emptyReplies++
        else if (e.a === 'regenerate') turnQuality.regenerated++
        else if (e.a === 'quick_followup') turnQuality.quickFollowups++
        else if (e.a === 'copy') turnQuality.copies++
        else if (e.a === 'branch') turnQuality.branches++
        else if (e.a === 'complete') {
          if (typeof e.m?.ms === 'number') latencies.push(e.m.ms)
          const outcome = typeof e.m?.outcome === 'string' ? e.m.outcome : 'ok'
          const id = typeof e.m?.turn === 'string' ? e.m.turn : null
          const tracked = id ? turnMap.get(id) : undefined
          if (tracked) tracked.outcome = outcome
          else legacyOutcomes.push(outcome) // legado ou início fora da janela
          // Latência por modelo (join complete→turn): atribui o tempo ao modelo
          // do turno (v2.108.0).
          if (typeof e.m?.ms === 'number' && id) {
            const model = turnModel.get(id)
            if (model) (latByModel[model] ||= []).push(e.m.ms)
          }
        } else if (e.a === 'stream_profile') {
          if (typeof e.m?.turn === 'string') turnsWithProfile.add(e.m.turn)
          streamShare.samples++
          for (const k of ['waitMs', 'reasoningMs', 'toolMs', 'contentMs'] as const) {
            if (typeof e.m?.[k] === 'number') streamShare[k] += e.m[k] as number
          }
          const toolMs = typeof e.m?.toolMs === 'number' ? e.m.toolMs : 0
          if (toolMs >= LONG_TOOL_ASSEMBLY_MS) streamShare.longToolAssemblies++
          if (toolMs > 0) {
            // Atribui o tempo de montagem à ferramenta do passo (join turn+step).
            const peers = typeof e.m?.turn === 'string' ? toolsByStep.get(stepKey(e.m.turn, e.m.step)) : undefined
            const name = peers && peers.length === 1 ? peers[0] : 'unattributed'
            bump2(streamShare.toolMsByName, name, toolMs)
          }
          // Correlação cold-start: a espera deste passo vs a duração da execução
          // local do passo ANTERIOR (prevToolMs, anexado pelo useChat).
          if (typeof e.m?.waitMs === 'number' && typeof e.m?.prevToolMs === 'number') {
            const bucket = e.m.prevToolMs >= LONG_LOCAL_EXEC_MS ? streamShare.coldStart.afterLong : streamShare.coldStart.afterShort
            bucket.n++
            bucket.waitMs += e.m.waitMs
          }
        }
        break
      case 'tool':
        if (e.a === 'use') {
          const tname = String(e.m?.name ?? 'unknown')
          bump(toolUsage, tname)
          toolUsesTotal++
          if (!e.m?.name || tname === 'unknown') toolUsesUnknown++
          // Taxa de falha (v2.108.0): o ok:false antes descartado.
          if (e.m?.ok === false) bump(toolFailures, tname)
        }
        else if (e.a === 'denied') friction.toolDenials++
        else if (e.a === 'rewrite_existing') friction.rewriteExisting++
        break
      case 'agent':
        if (e.a === 'circuit_break') friction.circuitBreaks++
        break
      case 'context':
        if (e.a === 'compaction') friction.contextCompactions++
        break
      case 'skill':
        if (e.a === 'load') bump(skillUsage, String(e.m?.name ?? 'unknown'))
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

  // Segmentação por modelo (v2.108.0): junta turnos+erros+latências por modelo.
  const byModel: Record<string, ModelStats> = {}
  const allModels = new Set([...Object.keys(turnsByModel), ...Object.keys(errorsByModel), ...Object.keys(latByModel)])
  for (const m of allModels) {
    const t = turnsByModel[m] || 0
    const errs = errorsByModel[m] || 0
    const lat = computeLatency(latByModel[m] || [])
    byModel[m] = { turns: t, errors: errs, errorRate: t > 0 ? Math.round((errs / t) * 100) / 100 : 0, avgMs: lat.avgMs, p95Ms: lat.p95Ms }
  }
  // Cobertura de instrumentação (v2.108.0): quanto do sinal está "cego".
  const dataQuality = {
    unknownModelRate: turnsStarted > 0 ? Math.round(((turnsByModel['unknown'] || 0) / turnsStarted) * 100) / 100 : 0,
    unknownToolRate: toolUsesTotal > 0 ? Math.round((toolUsesUnknown / toolUsesTotal) * 100) / 100 : 0,
    profileCoverage: turnMap.size > 0 ? Math.round((turnsWithProfile.size / turnMap.size) * 100) / 100 : 0,
  }

  const base = {
    generatedAt: now,
    windowDays,
    totalEvents: recent.length,
    errorsByKind,
    featureUsage,
    toolUsage,
    toolFailures,
    providerMix,
    modelMix,
    byModel,
    dataQuality,
    turnQuality,
    skillUsage,
    friction,
    latency: computeLatency(latencies),
    turns,
    streamShare,
    versionMix,
    comparison: compareVersionSegments(recent, now),
    trend: computeWindowTrend(recent, now - (windowDays / 2) * 24 * 60 * 60 * 1000),
  }
  const findings = buildFindings(base)
  // topPriority (v2.110.0): o 1º achado acionável (não-info) já ranqueado — o
  // ponteiro único de "faça isto a seguir" para o loop.
  const topPriority = findings.find((f) => f.severity !== 'info') ?? null
  return { ...base, findings, topPriority, notes: findings.map(renderFinding) }
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
  // Prioridade nº1 em destaque (v2.110.0): o que atacar a seguir.
  if (d.topPriority) {
    const icon: Record<FindingSeverity, string> = { critical: '🔴', warning: '🟡', info: '🔵' }
    lines.push(`## ▶ Prioridade nº1`, `${icon[d.topPriority.severity]} ${renderFinding(d.topPriority)}`, ``)
  }
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
    )
    const byName = Object.entries(s.toolMsByName).sort((a, b) => b[1] - a[1])
    if (byName.length) {
      const tShare = (ms: number) => s.toolMs > 0 ? `${Math.round((ms / s.toolMs) * 100)}%` : '0%'
      lines.push(`- montagem por ferramenta: ${byName.map(([n, ms]) => `${n} ${tShare(ms)}`).join(' · ')}`)
    }
    lines.push(``)
  }
  section('Erros por categoria', d.errorsByKind)
  section('Uso de features', d.featureUsage)
  // Uso de tools com TAXA de falha por ferramenta (v2.108.0).
  {
    const entries = Object.entries(d.toolUsage).sort((a, b) => b[1] - a[1])
    if (entries.length) {
      lines.push(`## Uso de tools (uso · falhas)`)
      for (const [k, uses] of entries) {
        const fails = d.toolFailures[k] || 0
        lines.push(`- ${k}: ${uses}${fails ? ` · ${fails} falha(s) (${Math.round((fails / uses) * 100)}%)` : ''}`)
      }
      lines.push(``)
    }
  }
  section('Provedores', d.providerMix)
  section('Modelos', d.modelMix)
  // Métricas por modelo (v2.108.0): latência + erro segmentados.
  {
    const entries = Object.entries(d.byModel).sort((a, b) => b[1].turns - a[1].turns)
    if (entries.length) {
      lines.push(`## Por modelo (turnos · erro/turno · p95)`)
      for (const [m, st] of entries) {
        lines.push(`- ${m}: ${st.turns} turnos · ${st.errorRate} erro/turno${st.p95Ms ? ` · p95 ${Math.round(st.p95Ms / 1000)}s` : ''}`)
      }
      lines.push(``)
    }
  }
  // Qualidade da instrumentação (v2.108.0).
  if (d.turns.started >= 5) {
    const q = d.dataQuality
    lines.push(`## Qualidade do sinal`,
      `- modelo desconhecido: ${Math.round(q.unknownModelRate * 100)}% · tool sem nome: ${Math.round(q.unknownToolRate * 100)}% · cobertura de perfil: ${Math.round(q.profileCoverage * 100)}%`, ``)
  }
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
  // (In)satisfação (v2.109.0).
  const tq = d.turnQuality
  if (tq.regenerated + tq.quickFollowups + tq.copies + tq.branches > 0) {
    lines.push(`## Satisfação (proxies)`,
      `- regenerações: ${tq.regenerated} · re-perguntas rápidas: ${tq.quickFollowups} · cópias: ${tq.copies} · bifurcações: ${tq.branches}`, ``)
  }
  section('Skills carregadas', d.skillUsage)
  if (d.latency.count > 0) {
    lines.push(`## Latência`, `- amostras: ${d.latency.count} · média: ${d.latency.avgMs}ms · p95: ${d.latency.p95Ms}ms`, ``)
  }
  // Tendência intra-janela (v2.110.0).
  if (d.trend) {
    const t = d.trend
    lines.push(`## Tendência (1ª metade → 2ª metade da janela)`,
      `- erros/turno: ${t.firstHalf.errorRate} → ${t.secondHalf.errorRate} · atrito/turno: ${t.firstHalf.frictionRate} → ${t.secondHalf.frictionRate} · insatisfação/turno: ${t.firstHalf.dissatisfactionRate} → ${t.secondHalf.dissatisfactionRate} · latência: ${Math.round(t.firstHalf.avgMs / 1000)}s → ${Math.round(t.secondHalf.avgMs / 1000)}s`)
    if (t.worsening.length) lines.push(`- piorando: ${t.worsening.map(w => w.metric).join(', ')}`)
    if (t.improving.length) lines.push(`- melhorando: ${t.improving.map(w => w.metric).join(', ')}`)
    lines.push(``)
  }
  if (d.findings.length) {
    const icon: Record<FindingSeverity, string> = { critical: '🔴', warning: '🟡', info: '🔵' }
    lines.push(`## Achados (por impacto)`)
    for (const f of d.findings) lines.push(`- ${icon[f.severity]} ${renderFinding(f)}`)
    lines.push(``)
  }
  return lines.join('\n')
}
