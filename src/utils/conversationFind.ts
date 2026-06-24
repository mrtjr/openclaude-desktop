// ─── Busca DENTRO da conversa ativa (Ctrl+F, v2.135.0) ──────────────
// Já temos busca cross-sessão; faltava o "find in page" do ChatGPT/Claude:
// achar e pular entre as mensagens da conversa atual que casam com o termo.
// Núcleo puro e testado; App monta a barra, rola até o acerto e o destaca.

import type { Message } from '../types'

/** Mensagens que aparecem como bolha própria (puláveis pela busca): do
 *  usuário ou respostas finais do assistente — não passos de ferramenta
 *  (agrupados/colapsados) nem turnos ocultos de continuação. */
function isSearchable(m: Message): boolean {
  if (m.hidden || !m.content) return false
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) return false
  return m.role === 'user' || m.role === 'assistant'
}

export interface FindHit {
  id: string
  /** Quantas vezes o termo aparece nesta mensagem (para o total de acertos). */
  count: number
}

/** Conta ocorrências não sobrepostas de `needle` em `hay` (case-insensitive). */
export function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0
  const h = hay.toLowerCase()
  const n = needle.toLowerCase()
  let count = 0
  let from = 0
  for (;;) {
    const i = h.indexOf(n, from)
    if (i === -1) break
    count++
    from = i + n.length
  }
  return count
}

/**
 * As mensagens da conversa que casam com o termo, em ordem de documento.
 * Termo vazio/curto (< 2 chars após trim) → nenhum acerto (evita destacar a
 * conversa inteira a cada tecla). Cada acerto carrega a contagem de ocorrências.
 */
export function findMessageMatches(messages: Message[], query: string): FindHit[] {
  const q = query.trim()
  if (q.length < 2) return []
  const hits: FindHit[] = []
  for (const m of messages) {
    if (!isSearchable(m)) continue
    const count = countOccurrences(m.content, q)
    if (count > 0) hits.push({ id: m.id, count })
  }
  return hits
}

/** Total de ocorrências em todos os acertos (para o rótulo "N resultados"). */
export function totalOccurrences(hits: FindHit[]): number {
  return hits.reduce((sum, h) => sum + h.count, 0)
}

/** Avança/retrocede o índice de acerto com wrap-around. Vazio → 0. */
export function stepHitIndex(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return 0
  return (current + dir + total) % total
}
