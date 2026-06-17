// ─── search_conversations (recall cross-sessão — v2.82.2) ──────────
//
// Inspirado no "FTS5 session search with cross-session recall" do Hermes: dá ao
// chat memória de LONGO PRAZO sobre as PRÓPRIAS conversas — "o que decidimos
// sobre X semana passada?", "achei aquele comando que usei no projeto Y". Sem
// SQLite: scan linear em memória sobre as conversas persistidas (escala de
// centenas, capado). Tudo PURO/testável; a lista de conversas é injetada (vem
// do conversationsRef do App).

export interface ConvMessageLike { role?: string; content?: string }
export interface ConversationLike {
  id: string
  title?: string
  createdAt?: number | string | Date
  messages?: ConvMessageLike[]
}

export interface ConvMatch {
  convId: string
  title: string
  createdAt: number
  role: string
  snippet: string
  overlap: number
}

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function toMs(d: number | string | Date | undefined): number {
  if (typeof d === 'number') return d
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Termos de conteúdo da consulta (≥2 chars, sem duplicar), em forma normalizada. */
export function queryTerms(query: string): string[] {
  return [...new Set(norm(query).split(/[^a-z0-9]+/).filter(w => w.length >= 2))]
}

/** Recorta um trecho ao redor da 1ª ocorrência de qualquer termo. */
export function snippetAround(content: string, terms: string[], len = 160): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  const low = norm(flat)
  let idx = -1
  for (const t of terms) { const i = low.indexOf(t); if (i !== -1 && (idx === -1 || i < idx)) idx = i }
  if (idx === -1) return flat.length > len ? flat.slice(0, len) + '…' : flat
  const start = Math.max(0, idx - Math.floor(len / 3))
  const end = Math.min(flat.length, start + len)
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '')
}

/** Busca nas conversas (exceto a ativa, cujo conteúdo recente já está no
 *  contexto). Ranqueia por nº de termos distintos casados na mensagem e, em
 *  empate, por recência da conversa. Devolve matches a nível de MENSAGEM. */
export function searchConversations(
  conversations: ConversationLike[] | undefined,
  query: string,
  opts: { excludeId?: string; max?: number; snippetLen?: number } = {},
): ConvMatch[] {
  const terms = queryTerms(query)
  if (!terms.length || !Array.isArray(conversations)) return []
  const max = opts.max ?? 8
  const out: ConvMatch[] = []
  for (const c of conversations) {
    if (!c || !c.id || c.id === opts.excludeId) continue
    const createdAt = toMs(c.createdAt)
    for (const m of c.messages || []) {
      const content = m?.content
      if (!content || typeof content !== 'string') continue
      const low = norm(content)
      let overlap = 0
      for (const t of terms) if (low.includes(t)) overlap++
      if (overlap > 0) {
        out.push({
          convId: c.id,
          title: (c.title || 'Sem título').trim(),
          createdAt,
          role: m.role || 'assistant',
          snippet: snippetAround(content, terms, opts.snippetLen),
          overlap,
        })
      }
    }
  }
  out.sort((a, b) => b.overlap - a.overlap || b.createdAt - a.createdAt)
  return out.slice(0, max)
}

/** Formata os achados para o modelo, agrupando por conversa. `now` injetado. */
export function formatConversationMatches(matches: ConvMatch[], query: string, now: Date): string {
  if (!matches.length) {
    return `Nada encontrado nas conversas anteriores sobre "${query}". (A conversa atual não é incluída — o que foi dito aqui já está no seu contexto.)`
  }
  const byConv = new Map<string, ConvMatch[]>()
  for (const m of matches) {
    if (!byConv.has(m.convId)) byConv.set(m.convId, [])
    byConv.get(m.convId)!.push(m)
  }
  const blocks: string[] = []
  for (const [, list] of byConv) {
    const first = list[0]
    const days = first.createdAt ? Math.max(0, Math.round((now.getTime() - first.createdAt) / 86_400_000)) : null
    const when = days === null ? '' : days === 0 ? ' (hoje)' : ` (há ${days}d)`
    const lines = list.map(m => `  • [${m.role}] ${m.snippet}`)
    blocks.push(`### ${first.title}${when}\n${lines.join('\n')}`)
  }
  return `Trechos de conversas ANTERIORES sobre "${query}" (use para retomar o contexto; não reabra a conversa, apenas reutilize o que for útil):\n\n${blocks.join('\n\n')}`
}
