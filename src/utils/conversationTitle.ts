// ─── Título da conversa (renomear + auto-título, v2.137.0) ──────────
// Renomear conversas (estilo ChatGPT/Claude) e, num ciclo seguinte, gerar um
// título melhor que o "primeiros 40 chars". Aqui ficam as partes puras.

/** Normaliza um título digitado pelo usuário: tira quebras, junta espaços e
 *  limita o tamanho. Devolve string vazia se nada sobrar (o chamador então
 *  ignora o rename, mantendo o título atual). */
export function sanitizeTitle(raw: string, maxLen = 80): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > maxLen ? t.slice(0, maxLen).trimEnd() : t
}

/** Deriva um título a partir da primeira mensagem do usuário — melhor que um
 *  corte cego em 40 chars: corta no fim de frase/palavra mais próximo e remove
 *  marcadores de markdown comuns do início. Usado quando o título é automático. */
export function deriveTitleFromMessage(text: string, maxLen = 48): string {
  let t = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')          // remove blocos de código
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1') // [rótulo](url) / ![alt](url) → rótulo (v2.175.0)
    .replace(/\bhttps?:\/\/\S+/gi, ' ')        // URLs cruas → fora do título
    .replace(/[`*_>#]+/g, '')                  // marcadores inline/headers
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return 'Nova conversa'
  // Primeira linha/frase, se for curta o bastante para virar título.
  const firstSentence = t.split(/(?<=[.!?])\s/)[0]
  if (firstSentence && firstSentence.length <= maxLen) t = firstSentence
  if (t.length <= maxLen) return t.replace(/[.,;:]+$/, '')
  // Corta na última fronteira de palavra dentro do limite (sem cortar palavra).
  const clip = t.slice(0, maxLen)
  const lastSpace = clip.lastIndexOf(' ')
  const base = (lastSpace > maxLen * 0.6 ? clip.slice(0, lastSpace) : clip).replace(/[.,;:]+$/, '')
  return base + '…'
}
