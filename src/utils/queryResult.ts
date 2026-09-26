// ─── Saída do postgres_query para o modelo — pura ───────────────────
//
// A saída de TODA tool passa por compressOutput (colapsa linhas parecidas) e
// truncateToolOutput (corta o MEIO acima de TOOL_OUTPUT_LIMIT). Um JSON com uma
// linha da tabela por linha de texto quebraria nos dois: as linhas "parecidas"
// de um relatório numérico sumiriam, e o corte no meio deixaria JSON inválido.
// Por isso: JSON numa linha só, e as linhas do resultado são reduzidas ATÉ
// caber no limite — avisando quantas ficaram de fora e como refinar.

import { TOOL_OUTPUT_LIMIT } from './toolPolicy'

export interface QueryResult {
  columns?: string[]
  rows?: unknown[][]
  rowCount?: number
  /** O banco tinha mais linhas do que o teto buscado pelo main. */
  truncated?: boolean
}

/** Uma célula gigante (texto longo, JSON) não pode sozinha comer o limite. */
export const CELL_MAX_CHARS = 300

function clipCell(v: unknown): unknown {
  if (v !== null && typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > CELL_MAX_CHARS ? s.slice(0, CELL_MAX_CHARS) + `…[+${s.length - CELL_MAX_CHARS}]` : v
  }
  if (typeof v === 'string' && v.length > CELL_MAX_CHARS) return v.slice(0, CELL_MAX_CHARS) + `…[+${v.length - CELL_MAX_CHARS}]`
  return v
}

/** JSON de uma linha: `{ columns, rows, rowCount }`, e — quando algo ficou de
 *  fora — `rowsShown`, `truncated: true` e uma `note` dizendo como refinar. */
export function formatQueryResult(r: QueryResult, budget = TOOL_OUTPUT_LIMIT): string {
  const columns = r.columns ?? []
  const all = (r.rows ?? []).map((row) => (Array.isArray(row) ? row.map(clipCell) : row))
  const fetched = all.length
  const refine = 'refine com filtros, agregação (SUM/COUNT/GROUP BY) ou LIMIT/OFFSET'
  const build = (n: number): string => {
    const base = { columns, rows: all.slice(0, n), rowCount: fetched }
    if (n === fetched && !r.truncated) return JSON.stringify(base)
    const more = r.truncated ? `o banco tem mais de ${fetched} linhas; ` : ''
    const shown = n === fetched ? `mostrando as ${n} primeiras` : `mostrando ${n} de ${fetched} (limite de saída)`
    return JSON.stringify({ ...base, rowsShown: n, truncated: true, note: `${more}${shown} — ${refine}` })
  }
  if (build(fetched).length <= budget) return build(fetched)
  // Maior n que cabe (o tamanho cresce com n → busca binária).
  let lo = 0, hi = fetched
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (build(mid).length <= budget) lo = mid
    else hi = mid - 1
  }
  return build(lo)
}
