// ─── Model Pricing ──────────────────────────────────────────────────
// Prices per 1 million tokens (USD). Refreshed June 2026.
// Ollama models are free (local). Unknown models default to $0.

export interface ModelPricing {
  input: number   // $ per 1M input tokens
  output: number  // $ per 1M output tokens
}

export const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3': { input: 10.00, output: 40.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40 },
  // Anthropic — 2026 lineup. Opus 4.5–4.8 are $5/$25 (down from the old
  // $15/$75); Sonnet 4.5/4.6 $3/$15; Haiku 4.5 $1/$5. (docs.anthropic.com)
  'claude-opus-4-8': { input: 5.00, output: 25.00 },
  'claude-opus-4-7': { input: 5.00, output: 25.00 },
  'claude-opus-4-6': { input: 5.00, output: 25.00 },
  'claude-opus-4-5': { input: 5.00, output: 25.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  'claude-opus-4-1': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  // Gemini
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  // OpenRouter popular
  'google/gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'anthropic/claude-sonnet-4': { input: 3.00, output: 15.00 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'deepseek/deepseek-r1': { input: 0.55, output: 2.19 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.39, output: 0.39 },
}

/** Family-tier fallbacks for models we haven't added to PRICING yet.
 *  Chosen to match the median of that family's public prices so a new
 *  GPT-5 or Claude-Opus-5 doesn't get silently tracked as free. Always
 *  an over-estimate for safer/older models, never an under-estimate
 *  for newer/bigger ones. */
const FAMILY_FALLBACK: Array<{ match: RegExp; pricing: ModelPricing; family: string }> = [
  { match: /^gpt-4o-mini|4o-mini/i, pricing: { input: 0.15, output: 0.60 }, family: 'gpt-4o-mini' },
  { match: /^gpt-4o|o4|4o\b/i, pricing: { input: 2.50, output: 10.00 }, family: 'gpt-4o' },
  { match: /^gpt-5|gpt-4\.5|o5/i, pricing: { input: 10.00, output: 40.00 }, family: 'gpt-5-tier' },
  { match: /^o3|o1(-|$)/i, pricing: { input: 10.00, output: 40.00 }, family: 'o-series' },
  { match: /^gpt-4/i, pricing: { input: 10.00, output: 30.00 }, family: 'gpt-4' },
  { match: /^gpt-3/i, pricing: { input: 0.50, output: 1.50 }, family: 'gpt-3.5' },
  { match: /haiku/i, pricing: { input: 0.80, output: 4.00 }, family: 'claude-haiku' },
  { match: /sonnet/i, pricing: { input: 3.00, output: 15.00 }, family: 'claude-sonnet' },
  { match: /opus/i, pricing: { input: 15.00, output: 75.00 }, family: 'claude-opus' },
  { match: /claude-\d/i, pricing: { input: 3.00, output: 15.00 }, family: 'claude-generic' },
  { match: /gemini.*flash/i, pricing: { input: 0.15, output: 0.60 }, family: 'gemini-flash' },
  { match: /gemini.*pro/i, pricing: { input: 1.25, output: 10.00 }, family: 'gemini-pro' },
  { match: /gemini-\d/i, pricing: { input: 0.15, output: 0.60 }, family: 'gemini-generic' },
]

/** Local-model prefixes that are legitimately free. */
const LOCAL_MODEL_PREFIXES = ['llama', 'qwen', 'mistral', 'mixtral', 'deepseek-r1-distill', 'phi', 'gemma', 'codellama', 'nous-', 'dolphin', 'uncensored']

/** Track which unknown models we've already warned about (once per model). */
const WARNED_UNKNOWN = new Set<string>()

/** Returns true if the model name looks like a local/Ollama model. */
function isLikelyLocalModel(model: string): boolean {
  const lower = model.toLowerCase()
  // Ollama-style tags use ":" (e.g. llama3:8b) — always local.
  if (lower.includes(':')) return true
  return LOCAL_MODEL_PREFIXES.some(p => lower.startsWith(p) || lower.includes('/' + p))
}

/** Get pricing for a model.
 *  1. Exact match in PRICING table wins.
 *  2. Case-insensitive substring match against PRICING keys (handles
 *     OpenRouter-style `openai/gpt-4o-2024-11-20` → `gpt-4o`).
 *  3. Family regex fallback — a new `gpt-5-turbo` gets the gpt-5 tier
 *     instead of $0. A `claude-opus-5` gets opus pricing.
 *  4. Local-model prefixes (Ollama llama/qwen/mistral/…) → $0.
 *  5. Truly unknown — log a one-time warning and return $0. This at
 *     least surfaces the gap in the devtools console. */
export function getModelPricing(model: string): ModelPricing {
  if (PRICING[model]) return PRICING[model]
  const modelLower = model.toLowerCase()
  // Prefer the LONGEST (most specific) key that is a substring of the model
  // id. Returning the first match instead made dated variants resolve to
  // their shorter, pricier sibling — e.g. "gpt-4o-mini-2024-07-18" matched
  // "gpt-4o" (16× too dear), "o3-mini-2025-01-31" matched "o3" (9×).
  let best: ModelPricing | null = null
  let bestLen = 0
  for (const [key, pricing] of Object.entries(PRICING)) {
    const k = key.toLowerCase()
    if (k.length > bestLen && modelLower.includes(k)) {
      best = pricing
      bestLen = k.length
    }
  }
  if (best) return best
  for (const fb of FAMILY_FALLBACK) {
    if (fb.match.test(model)) return fb.pricing
  }
  if (isLikelyLocalModel(model)) return { input: 0, output: 0 }
  if (!WARNED_UNKNOWN.has(model)) {
    WARNED_UNKNOWN.add(model)
    console.warn(`[pricing] Unknown model "${model}" — cost tracking will show $0. Add it to PRICING or a FAMILY_FALLBACK pattern.`)
  }
  return { input: 0, output: 0 }
}

/** Calculate cost for a given number of tokens */
export function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = getModelPricing(model)
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

/** Format cost for display */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}
