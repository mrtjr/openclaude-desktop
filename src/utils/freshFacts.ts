// ─── Cache de fatos frescos verificados (Camada 3 — v2.62.0) ────────
//
// Quando o agente VERIFICA um fato sensível a tempo na web (Camada 1/2), seria
// desperdício re-buscar a mesma coisa amanhã. Aqui guardamos o fato verificado
// com PROCEDÊNCIA (fonte + data) e um TTL — diferente da memória durável, um
// fato fresco DECAI. No reuso: se ainda está dentro do TTL, injetamos como
// "reuse, não re-busque"; se venceu, injetamos como "possivelmente
// desatualizado, re-verifique" (o que casa com o nudge de frescor da Camada 2).
//
// Reusa a memória persistente (bucket novo `fresh`) — ver persistentMemory.ts.
// Tudo aqui é PURO/testável; a I/O (loadMemory/saveMemory) vive em
// useToolExecution/useChat. `now` é injetado para os helpers serem determinísticos.

export interface FreshFact {
  /** O fato verificado, conciso e auto-contido. */
  text: string
  /** URL/origem da verificação (opcional, mas recomendado). */
  source?: string
  /** Quando foi verificado (ISO). */
  verifiedAt: string
  /** Horizonte de validade em dias — depois disso vira "stale". */
  ttlDays: number
}

const DAY_MS = 86_400_000

/** Teto do bucket de fatos frescos (mais enxuto que os 100 dos buckets
 *  duráveis — fatos frescos são voláteis). */
export const FRESH_FACTS_CAP = 60
export const DEFAULT_TTL_DAYS = 14

/** Normaliza p/ casamento: NFD + remove diacríticos (\p{Diacritic}, sem chars
 *  combinantes no fonte) + lowercase + colapsa espaços. */
function norm(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Infere um TTL pelo teor do fato: cotações/notícias mudam em horas; versões/
 *  APIs em semanas; o resto, o padrão. */
export function inferTtlDays(text: string): number {
  const t = norm(text)
  if (/\b(preco|cotacao|price|stock|bitcoin|dolar|euro|acao|acoes|cripto|taxa)\b/.test(t)) return 1
  if (/\b(noticia|noticias|news|hoje|today|breaking|placar|clima|weather|tempo)\b/.test(t)) return 1
  if (/\b(versao|version|release|lancamento|changelog|sdk|api|biblioteca|library|framework|modelo|model)\b/.test(t)) return 30
  return DEFAULT_TTL_DAYS
}

/** Idade do fato em dias (Infinity se a data for inválida). */
export function ageDays(fact: FreshFact, now: Date): number {
  const t = Date.parse(fact.verifiedAt)
  if (Number.isNaN(t)) return Infinity
  return (now.getTime() - t) / DAY_MS
}

/** Venceu o TTL? */
export function isExpired(fact: FreshFact, now: Date): boolean {
  return ageDays(fact, now) > fact.ttlDays
}

/** Adiciona (ou re-verifica) um fato fresco. Re-verificação do MESMO fato
 *  substitui o antigo (atualiza data/fonte). Dedup por texto normalizado, cap
 *  com descarte do mais antigo. Não muta a lista de entrada. */
export function addFreshFact(
  list: FreshFact[] | undefined,
  input: { text: string; source?: string; ttlDays?: number },
  now: Date,
): { list: FreshFact[]; added: boolean } {
  const text = (input.text || '').trim()
  if (!text) return { list: normalizeList(list), added: false }
  const ttlDays = input.ttlDays && input.ttlDays > 0 ? Math.round(input.ttlDays) : inferTtlDays(text)
  const src = (input.source || '').trim()
  const fact: FreshFact = { text, source: src || undefined, verifiedAt: now.toISOString(), ttlDays }
  const key = norm(text)
  const filtered = normalizeList(list).filter((f) => norm(f.text) !== key)
  const next = [...filtered, fact]
  while (next.length > FRESH_FACTS_CAP) next.shift()
  return { list: next, added: true }
}

/** Remove fatos vencidos além de uma folga (ttl * grace) para não crescer sem
 *  limite — os recém-vencidos ficam um tempo como "stale" (dica de re-verificar). */
export function pruneFreshFacts(list: FreshFact[] | undefined, now: Date, graceMultiplier = 2): FreshFact[] {
  return normalizeList(list).filter((f) => ageDays(f, now) <= f.ttlDays * graceMultiplier)
}

/** Recupera os fatos relevantes à consulta, separados em frescos vs vencidos.
 *  Relevância = sobreposição de palavras (>=4 chars) entre consulta e fato. */
export function recallFreshFacts(
  list: FreshFact[] | undefined,
  queryText: string,
  now: Date,
  max = 5,
): { fresh: FreshFact[]; stale: FreshFact[] } {
  const items = normalizeList(list)
  const q = norm(queryText)
  if (!q || !items.length) return { fresh: [], stale: [] }
  const qWords = new Set(q.split(' ').filter((w) => w.length >= 4))
  if (!qWords.size) return { fresh: [], stale: [] }
  const scored = items
    .map((f) => {
      const fw = new Set(norm(f.text).split(' '))
      let overlap = 0
      for (const w of fw) if (qWords.has(w)) overlap++
      return { f, overlap }
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
  const fresh: FreshFact[] = []
  const stale: FreshFact[] = []
  for (const { f } of scored) {
    if (isExpired(f, now)) {
      if (stale.length < max) stale.push(f)
    } else if (fresh.length < max) {
      fresh.push(f)
    }
  }
  return { fresh, stale }
}

/** Bloco injetado no contexto (vazio se não houver nada relevante). */
export function renderFreshFactsBlock(
  fresh: FreshFact[],
  stale: FreshFact[],
  lang: string,
  now: Date,
): string {
  if (!fresh.length && !stale.length) return ''
  const isEn = lang === 'en'
  const lines: string[] = [
    isEn
      ? '[RECENTLY VERIFIED FACTS — reuse these, do NOT re-search while still fresh]'
      : '[FATOS VERIFICADOS RECENTEMENTE — reuse, NÃO re-busque enquanto frescos]',
  ]
  for (const f of fresh) lines.push(`- ${f.text} (${stamp(f, now, isEn)})`)
  if (stale.length) {
    lines.push(
      isEn
        ? 'Possibly OUTDATED (re-verify with web_search/fetch_url before using):'
        : 'Possivelmente DESATUALIZADO (re-verifique com web_search/fetch_url antes de usar):',
    )
    for (const f of stale) lines.push(`- ${f.text} (${stamp(f, now, isEn)})`)
  }
  return lines.join('\n')
}

function stamp(f: FreshFact, now: Date, isEn: boolean): string {
  const d = Math.max(0, Math.round(ageDays(f, now)))
  const when = isEn ? `verified ${d}d ago` : `verificado há ${d}d`
  const src = f.source ? ` — ${f.source}` : ''
  return `${when}${src}`
}

/** Coage entrada desconhecida numa lista de FreshFact válidos. */
function normalizeList(list: unknown): FreshFact[] {
  if (!Array.isArray(list)) return []
  return list.filter(
    (f): f is FreshFact =>
      !!f && typeof f.text === 'string' && typeof f.verifiedAt === 'string' && typeof f.ttlDays === 'number',
  )
}
