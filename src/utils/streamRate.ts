// ─── Taxa de geração (tokens/s) durante o streaming (v2.134.0) ──────
// Estilo Codex: enquanto a resposta é transmitida, mostrar a velocidade ~tok/s.
// Sinal de "vida" útil (e satisfatório) durante turnos longos. Núcleo puro e
// testado; o componente StreamRateMeter aplica com um timer.

/**
 * Estimativa barata de tokens a partir do texto (≈ 4 chars/token, padrão para
 * PT/EN). Não precisa do tokenizer real (lazy/async) para um medidor ao vivo.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 4))
}

/**
 * Tokens por segundo dado o total estimado e o tempo decorrido. Devolve null
 * (não exibir) enquanto não há amostra confiável: < 1s de janela ou < 1 token.
 */
export function tokensPerSec(tokens: number, elapsedMs: number): number | null {
  if (elapsedMs < 1000 || tokens < 1) return null
  const rate = tokens / (elapsedMs / 1000)
  if (!isFinite(rate) || rate <= 0) return null
  return Math.round(rate)
}

/** Texto curto pronto para a UI, ex.: "≈ 42 tok/s". Vazio quando não há dado.
 *  Stream muito lento (taxa arredonda p/ 0) vira "< 1 tok/s" em vez do enganoso
 *  "≈ 0 tok/s" (v2.179.0). */
export function formatTokRate(tokens: number, elapsedMs: number): string {
  const r = tokensPerSec(tokens, elapsedMs)
  if (r === null) return ''
  if (r < 1) return '< 1 tok/s'
  return `≈ ${r} tok/s`
}
