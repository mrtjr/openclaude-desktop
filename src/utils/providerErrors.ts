// ─── Provider error classification & humanization ───────────────────
//
// Provider/network failures used to surface as a raw `Erro: <message>` dump
// (a bare "API error 429: {…}", "HTTP 401", a Node ECONNRESET, …) and the
// turn just failed. This maps those into a small set of actionable kinds so
// the UI can show a friendly message and the chat loop can auto-retry the
// genuinely transient ones (rate limit / overloaded / network blip).
//
// Error strings come from electron/main.js, which embeds HTTP status codes
// ("API error 429: …", "HTTP 503"), the provider's own error.message, Node
// socket error codes, and our request-timeout strings — so substring/keyword
// matching on the lowercased text is reliable.

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'overloaded'
  | 'network'
  | 'timeout'
  | 'context'
  | 'not_found'
  | 'unknown'

export interface ProviderErrorInfo {
  kind: ProviderErrorKind
  /** Safe to auto-retry once: a transient, pre-response failure where no
   *  partial output (and no billing) has happened yet. */
  retryable: boolean
}

/** Classify a raw provider/network error message. Order matters — the most
 *  specific / highest-signal checks come first. */
export function classifyProviderError(raw: string | undefined): ProviderErrorInfo {
  const m = (raw || '').toLowerCase()
  const has = (...subs: string[]) => subs.some((s) => m.includes(s))

  if (has('401', '403', 'unauthorized', 'invalid api key', 'invalid_api_key',
          'incorrect api key', 'authentication', 'permission denied', 'no auth'))
    return { kind: 'auth', retryable: false }

  if (has('429', 'rate limit', 'rate_limit', 'too many requests', 'quota', 'resource_exhausted'))
    return { kind: 'rate_limit', retryable: true }

  if (has('overloaded', '529', 'http 503', 'error 503', 'http 502', 'error 502',
          'http 500', 'error 500', 'service unavailable', 'bad gateway',
          'internal server error', 'server_error'))
    return { kind: 'overloaded', retryable: true }

  if (has('econnreset', 'enotfound', 'econnrefused', 'eai_again', 'epipe',
          'socket hang up', 'network', 'fetch failed', 'getaddrinfo'))
    return { kind: 'network', retryable: true }

  // Our own request-timeout strings ("Provider request timeout after 60s") or
  // a generic timeout: don't auto-retry (would just make the user wait the
  // full window again) — surface a clear message instead.
  if (has('etimedout', 'timeout', 'timed out'))
    return { kind: 'timeout', retryable: false }

  if (has('context length', 'maximum context', 'context_length', 'too many tokens',
          'reduce the length', 'maximum number of tokens', 'context window'))
    return { kind: 'context', retryable: false }

  if (has('404', 'not found', 'does not exist', 'no endpoints', "doesn't support",
          'model_not_found', 'unknown model', 'no such model'))
    return { kind: 'not_found', retryable: false }

  return { kind: 'unknown', retryable: false }
}

const MESSAGES: Record<ProviderErrorKind, { pt: string; en: string }> = {
  auth: {
    pt: 'Chave de API inválida ou ausente. Verifique a chave do provedor em Configurações.',
    en: 'Invalid or missing API key. Check the provider key in Settings.',
  },
  rate_limit: {
    pt: 'Limite de requisições do provedor atingido. Aguarde alguns segundos e tente novamente.',
    en: 'Provider rate limit reached. Wait a few seconds and try again.',
  },
  overloaded: {
    pt: 'O provedor está sobrecarregado ou instável no momento. Tente novamente em instantes.',
    en: 'The provider is overloaded or unstable right now. Please try again shortly.',
  },
  network: {
    pt: 'Falha de conexão com o provedor. Verifique sua internet (ou se o Ollama está rodando).',
    en: 'Network error reaching the provider. Check your connection (or that Ollama is running).',
  },
  timeout: {
    pt: 'O provedor demorou demais para responder. Tente de novo — se persistir, encurte a mensagem.',
    en: 'The provider took too long to respond. Try again — if it persists, shorten the message.',
  },
  context: {
    pt: 'A conversa excedeu a janela de contexto do modelo. Compacte o contexto ou inicie uma nova conversa.',
    en: 'The conversation exceeded the model context window. Compact it or start a new chat.',
  },
  not_found: {
    pt: 'Modelo ou endpoint não encontrado para este provedor. Confira o modelo selecionado.',
    en: 'Model or endpoint not found for this provider. Check the selected model.',
  },
  unknown: { pt: '', en: '' },
}

/** A short, actionable message for the user. Unknown errors keep the original
 *  detail (labelled) so nothing is hidden. */
export function humanizeProviderError(raw: string | undefined, lang: 'pt' | 'en' = 'pt'): string {
  const { kind } = classifyProviderError(raw)
  const friendly = MESSAGES[kind][lang]
  if (friendly) return friendly
  const prefix = lang === 'pt' ? 'Erro do provedor' : 'Provider error'
  return `${prefix}: ${raw || (lang === 'pt' ? 'desconhecido' : 'unknown')}`
}
