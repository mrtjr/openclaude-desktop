// ─── Status line configurável (v2.98.0) ─────────────────────────────
//
// Porta a "statusLine" do Claude Code: uma linha fina com o estado da sessão
// (modelo, provedor, branch git, pasta, persona, % de contexto). O usuário
// escolhe quais itens mostrar (settings.statusLineItems). Pura/testável; o App
// fornece os dados e renderiza.

export interface StatusLineData {
  model?: string
  provider?: string
  branch?: string
  cwd?: string
  persona?: string
  contextPct?: number
}

/** Itens disponíveis (ordem canônica de exibição). */
export const STATUS_LINE_ITEMS = ['model', 'provider', 'branch', 'cwd', 'persona', 'context'] as const
export type StatusLineItem = typeof STATUS_LINE_ITEMS[number]

const LABELS_PT: Record<StatusLineItem, string> = {
  model: 'modelo', provider: 'provedor', branch: 'branch', cwd: 'pasta', persona: 'persona', context: 'contexto',
}
const LABELS_EN: Record<StatusLineItem, string> = {
  model: 'model', provider: 'provider', branch: 'branch', cwd: 'folder', persona: 'persona', context: 'context',
}

/** Só o nome final de um caminho (basename), normalizando barras. */
export function basename(p: string | undefined): string {
  const s = String(p ?? '').replace(/[\\/]+$/, '')
  if (!s) return ''
  const parts = s.split(/[\\/]/)
  return parts[parts.length - 1] || s
}

/** Valor formatado de um item (vazio = não exibir). */
export function statusItemValue(item: StatusLineItem, data: StatusLineData): string {
  switch (item) {
    case 'model': return (data.model || '').trim()
    case 'provider': return (data.provider || '').trim()
    case 'branch': return (data.branch || '').trim()
    case 'cwd': return basename(data.cwd)
    case 'persona': return (data.persona || '').trim()
    case 'context': return data.contextPct != null && Number.isFinite(data.contextPct) ? `${Math.round(data.contextPct)}%` : ''
  }
}

/** Monta os segmentos visíveis (item + valor) na ordem canônica, só para os
 *  itens habilitados e com valor. */
export function buildStatusSegments(enabled: string[] | undefined, data: StatusLineData, lang: string): Array<{ key: string; label: string; value: string }> {
  const want = new Set(enabled || [])
  const labels = lang === 'en' ? LABELS_EN : LABELS_PT
  const out: Array<{ key: string; label: string; value: string }> = []
  for (const item of STATUS_LINE_ITEMS) {
    if (!want.has(item)) continue
    const value = statusItemValue(item, data)
    if (value) out.push({ key: item, label: labels[item], value })
  }
  return out
}

/** Versão em texto puro (ex.: para tooltip), separada por " · ". */
export function buildStatusLineText(enabled: string[] | undefined, data: StatusLineData, lang: string): string {
  return buildStatusSegments(enabled, data, lang).map((s) => s.value).join(' · ')
}
