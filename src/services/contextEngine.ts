// ─── Context Engine ────────────────────────────────────────────────
// Formal context assembly with token budgets and compaction strategies.
// Replaces ad-hoc context management in the chat loop.

import type { Message } from '../types'

export interface ContextEngine {
  /** Assemble messages within a token budget. Returns trimmed array. */
  assemble(messages: Message[], tokenBudget: number): Message[]
  /** Estimate token count for an array of messages */
  getTokenCount(messages: Message[]): number
  /** Get token count for a single string */
  countTokens(text: string): number
}

// ─── Token estimation ────────────────────────────────────────────
// Rough heuristic: ~4 chars per token for English, ~3 for CJK/mixed.
// This avoids loading tiktoken on the main thread (heavy WASM).
// For accurate counts, use tiktoken in a worker.

function estimateTokens(text: string): number {
  if (!text) return 0
  // Count CJK characters for mixed-language estimation
  const cjkCount = (text.match(/[\u3000-\u9fff\uac00-\ud7af]/g) || []).length
  const otherCount = text.length - cjkCount
  return Math.ceil(otherCount / 4 + cjkCount / 1.5)
}

function messageTokens(msg: Message): number {
  let tokens = estimateTokens(msg.content) + 4 // overhead per message
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      tokens += estimateTokens(tc.name) + estimateTokens(JSON.stringify(tc.arguments))
    }
  }
  if (msg.toolResults) {
    for (const tr of msg.toolResults) {
      tokens += estimateTokens(tr.result)
    }
  }
  return tokens
}

// ─── Default Context Engine (Truncation Strategy) ────────────────

export function createContextEngine(): ContextEngine {
  return {
    assemble(messages: Message[], tokenBudget: number): Message[] {
      if (messages.length === 0) return []

      // Always keep the most recent messages (they're most relevant)
      let totalTokens = 0
      const result: Message[] = []

      // Walk backwards from most recent, accumulating until we hit budget
      for (let i = messages.length - 1; i >= 0; i--) {
        const msgTokens = messageTokens(messages[i])
        if (totalTokens + msgTokens > tokenBudget && result.length > 0) {
          break
        }
        totalTokens += msgTokens
        result.unshift(messages[i])
      }

      return result
    },

    getTokenCount(messages: Message[]): number {
      return messages.reduce((sum, msg) => sum + messageTokens(msg), 0)
    },

    countTokens(text: string): number {
      return estimateTokens(text)
    },
  }
}

// ─── Model context limits (approximate) ──────────────────────────
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  'o1': 200_000,
  'o1-mini': 128_000,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  // Anthropic
  'claude-sonnet-4-20250514': 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  // Gemini
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  // Common Ollama models
  'llama3': 8_192,
  'llama3.1': 128_000,
  'llama3.2': 128_000,
  'mistral': 32_000,
  'mixtral': 32_000,
  'codestral': 32_000,
  'qwen2.5': 32_000,
  'deepseek-r1': 128_000,
  'deepseek-coder-v2': 128_000,
  'phi3': 128_000,
  'gemma2': 8_192,
  'command-r': 128_000,
}

/** Get approximate context limit for a model. Returns 8192 as safe default. */
export function getModelContextLimit(model: string): number {
  // Exact match first
  if (MODEL_CONTEXT_LIMITS[model]) return MODEL_CONTEXT_LIMITS[model]
  // Partial match (e.g., "gpt-4o-2024-08-06" matches "gpt-4o")
  const modelLower = model.toLowerCase()
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelLower.startsWith(key.toLowerCase()) || modelLower.includes(key.toLowerCase())) {
      return limit
    }
  }
  return 8_192 // safe default
}
