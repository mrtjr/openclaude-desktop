// ─── Per-turn token usage resolution ────────────────────────────────
//
// Usage drives the cost/usage dashboard. The streaming path reported it
// (with a char/4 fallback); the non-streaming path reported NOTHING, so
// non-streaming providers (Gemini, Ollama non-stream, custom OpenAI-compat
// without streaming) showed $0 spend. This shared helper fixes both: prefer
// the provider's real numbers, otherwise estimate with the real tokenizer
// (which itself falls back to char/4 until it lazy-loads — see Ciclo 5).

import { createContextEngine } from '../services/contextEngine'

const engine = createContextEngine()

export interface RawUsage {
  prompt_tokens?: number
  input_tokens?: number
  completion_tokens?: number
  output_tokens?: number
}

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
}

/** Resolve a single turn's token usage. Uses the provider's reported numbers
 *  when both input and output are present (OpenAI `prompt_tokens/completion_tokens`
 *  or Anthropic `input_tokens/output_tokens`); otherwise estimates from the
 *  request messages and the output text with the real tokenizer. */
export function resolveTurnUsage(
  providerUsage: RawUsage | null | undefined,
  requestMessages: Array<{ content?: unknown }>,
  outputText: string,
): TurnUsage {
  if (providerUsage) {
    const input = providerUsage.prompt_tokens ?? providerUsage.input_tokens
    const output = providerUsage.completion_tokens ?? providerUsage.output_tokens
    if (typeof input === 'number' && typeof output === 'number') {
      return { inputTokens: input, outputTokens: output }
    }
  }
  const inputTokens = requestMessages.reduce((sum, m) => {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
    return sum + engine.countTokens(c)
  }, 0)
  return { inputTokens, outputTokens: engine.countTokens(outputText || '') }
}
