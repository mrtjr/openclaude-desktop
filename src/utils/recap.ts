// ─── Session recap / "away summary" (v2.100.0) ──────────────────────
//
// Porta o "away summary / session recap" do Claude Code: quando um turno termina
// numa conversa que NÃO está aberta (a IA respondeu enquanto você olhava outra),
// resumir em uma linha o que ficou pronto, para um toast + marcar não-lida. Puro.

interface RecapMessage { role: string; content?: string }
interface RecapConv { title?: string; messages: RecapMessage[] }

/** Primeira linha não-vazia de um texto, sem markdown pesado, truncada. */
export function firstLine(text: string | undefined, max = 100): string {
  const raw = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1') // [rótulo](url) → rótulo (v2.182.0)
    .replace(/\bhttps?:\/\/\S+/gi, ' ')        // URLs cruas fora do recap
    .replace(/[#>*_`]/g, '')
  const line = (raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '')
    .replace(/[ \t]{2,}/g, ' ') // colapsa espaços (ex.: resíduo da remoção de URL)
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
}

/** Monta a frase de recap de uma conversa concluída fora de tela. lang 'en'|'pt'. */
export function buildRecap(conv: RecapConv | null | undefined, lang: string): string {
  const en = lang === 'en'
  const title = (conv?.title || '').trim() || (en ? 'a conversation' : 'uma conversa')
  const msgs = conv?.messages || []
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && (m.content || '').trim())
  const snippet = firstLine(lastAssistant?.content)
  if (!snippet) return en ? `Reply ready in "${title}"` : `Resposta pronta em "${title}"`
  return en ? `"${title}" — ${snippet}` : `"${title}" — ${snippet}`
}
