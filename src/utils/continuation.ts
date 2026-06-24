// ─── Continuar uma resposta truncada (v2.130.0) ─────────────────────
// Estilo ChatGPT "Continue generating". O default de max_tokens é 4096, então
// respostas longas são cortadas com frequência — antes isso era silencioso (a
// bolha parava no meio da frase, sem aviso e sem como continuar). Agora,
// quando o provedor sinaliza corte por limite de tokens, marcamos a mensagem
// como `truncated` e oferecemos um botão "Continuar gerando" que reenvia um
// turno (oculto) pedindo ao modelo para retomar de onde parou.
//
// Núcleo puro e testado. useChat marca a flag; App dispara a continuação.

import type { Language } from '../types'

/**
 * O turno foi cortado pelo limite de tokens (não por fim natural / tool call)?
 * Cobre os valores dos provedores que suportamos:
 *  - OpenAI / OpenRouter / Modal / Gemini-compat → 'length'
 *  - Anthropic (stop_reason) → 'max_tokens'
 *  - alguns gateways → 'max_output_tokens'
 */
export function isLengthTruncated(finishReason: string | undefined | null): boolean {
  if (!finishReason) return false
  const r = String(finishReason).toLowerCase()
  return r === 'length' || r === 'max_tokens' || r === 'max_output_tokens'
}

/** A instrução (turno de usuário OCULTO) que pede ao modelo para retomar. */
export function continuationPrompt(lang: Language): string {
  return lang === 'en'
    ? 'Continue your previous answer from exactly where it stopped. Do not repeat, re-introduce, or summarize anything you already wrote — pick up mid-sentence if that is where it ended.'
    : 'Continue sua resposta anterior exatamente de onde parou. Não repita, não reintroduza nem resuma nada do que já escreveu — retome do meio da frase, se foi onde terminou.'
}
