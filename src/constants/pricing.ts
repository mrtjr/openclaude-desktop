// ─── Model Pricing ──────────────────────────────────────────────────
// Prices per 1 million tokens (USD). Updated April 2025.
// Ollama models are free (local). Unknown models default to $0.

export interface ModelPricing {
  input: number   // $ per 1M input tokens
  output: number  // $ per 1M output tokens
}

export const PRICING: Record<string, ModelPricing> = {
  // OpenAI
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
  // Anthropic
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

/** Get pricing for a model. Returns {0,0} for local/unknown models. */
export function getModelPricing(model: string): ModelPricing {
  if (PRICING[model]) return PRICING[model]
  // Partial match
  const modelLower = model.toLowerCase()
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (modelLower.includes(key.toLowerCase())) return pricing
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
