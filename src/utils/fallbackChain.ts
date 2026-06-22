// ─── Cadeia de modelos de fallback (v2.91.0) ────────────────────────
//
// Porta o "fallbackModel: up to three fallback models tried in order" do Claude
// Code (Week 24) para o MODELO PRINCIPAL do chat. Quando o modelo ativo esgota
// os retries de um erro recuperável (overload/timeout/instabilidade), o loop do
// useChat troca para o PRÓXIMO modelo de fallback ainda não tentado (mesmo
// provedor) e refaz o passo, em vez de matar o turno. Pura + testável.

/** Próximo modelo de fallback ainda NÃO tentado, na ordem configurada. Pula o
 *  modelo atual e os já tentados. Devolve null quando a cadeia se esgotou. */
export function nextFallbackModel(
  current: string,
  chain: string[] | undefined,
  tried: Set<string>,
): string | null {
  const cur = (current || '').trim()
  const list = (chain || []).map((s) => String(s).trim()).filter(Boolean)
  for (const m of list) {
    if (m && m !== cur && !tried.has(m)) return m
  }
  return null
}

/** O erro é do tipo que um OUTRO modelo pode resolver? Overload/timeout/
 *  instabilidade/desconhecido/not_found sim; estouro de contexto, stall, tools e
 *  AUTH NÃO. auth (credencial inválida) afeta todos os modelos do provedor →
 *  trocar de modelo não conserta (fast-fail). context/stall têm caminhos
 *  próprios. (v2.118.0) */
export function isModelSwappableError(kind: string | undefined): boolean {
  return kind !== 'context' && kind !== 'stall' && kind !== 'tools' && kind !== 'auth'
}

/** Teto de trocas de modelo por turno — evita o usuário esperar uma cadeia
 *  longa/duplicada de fallbacks antes da falha final. (v2.118.0) */
export const MAX_FALLBACK_ATTEMPTS = 3
