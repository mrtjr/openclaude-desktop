// ─── Context Engine ────────────────────────────────────────────────
// Formal context assembly with token budgets and compaction strategies.
// Replaces ad-hoc context management in the chat loop.

import type { Message } from '../types'
import { realTokenCount } from './tokenizer'

export interface ContextEngine {
  /** Assemble messages within a token budget. Returns trimmed array. */
  assemble(messages: Message[], tokenBudget: number): Message[]
  /** Estimate token count for an array of messages */
  getTokenCount(messages: Message[]): number
  /** Get token count for a single string */
  countTokens(text: string): number
}

// ─── Token estimation ────────────────────────────────────────────
// Prefer the real BPE tokenizer (js-tiktoken o200k_base) once it has
// lazily loaded — exact for OpenAI families, a close approximation
// elsewhere, and crucially it counts JSON/code/CJK at their true (much
// higher) weight instead of under-counting them. Until the tokenizer is
// ready (first paint, or any non-UI caller like unit tests that never
// trigger the load) we fall back to the char/4 heuristic below. See
// services/tokenizer.ts.

function estimateTokens(text: string): number {
  if (!text) return 0
  const real = realTokenCount(text)
  if (real !== null) return real
  // Heuristic fallback. Count CJK characters for mixed-language estimation
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
// Updated v2.12.6 with late-2025/early-2026 models. Claude 4.x family
// and gpt-4.1 enter the list; Sonnet/Opus remain at 200k default
// (1M beta via header opt-in, tracked separately by the caller).
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4.1-nano': 1_000_000,
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
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-opus-4': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3-opus': 200_000,
  // Gemini
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  // Common Ollama models
  'llama3': 8_192,
  'llama3.1': 128_000,
  'llama3.2': 128_000,
  'llama3.3': 128_000,
  'mistral': 32_000,
  'mixtral': 32_000,
  'codestral': 32_000,
  'qwen2.5': 32_000,
  'qwen3': 128_000,
  'qwen35': 128_000,
  'deepseek-r1': 128_000,
  'deepseek-coder-v2': 128_000,
  'phi3': 128_000,
  'phi4': 128_000,
  'gemma2': 8_192,
  'gemma3': 128_000,
  'command-r': 128_000,
}

// ─── Autocompact thresholds ──────────────────────────────────────
// Matches Claude Code defaults: reserve ~15% for the compaction call
// itself to have working room, trigger autocompact at ≥85% used.
export const AUTOCOMPACT_BUFFER_RATIO = 0.15
export const AUTOCOMPACT_TRIGGER_RATIO = 0.85

// ─── Context breakdown (Claude-style /context panel) ─────────────
// Per-category token accounting. Sum of the "consumed" fields
// (messages + systemPrompt + memory + systemTools + mcpTools + skills)
// is the actual used; free = limit − used − autocompactBuffer.
// Deferred counts are BUDGET ACCOUNTING — they're the *potential*
// weight if the model pulled every deferred schema in at once. They
// don't add to `used` because they aren't injected upfront.
export interface ContextBreakdown {
  messages: number
  systemPrompt: number
  memory: number
  systemTools: number
  systemToolsDeferred: number
  mcpTools: number
  mcpToolsDeferred: number
  skills: number
  autocompactBuffer: number
  free: number
  used: number               // messages+systemPrompt+memory+systemTools+mcpTools+skills
  total: number              // used + autocompactBuffer
  limit: number
  percentage: number         // round(used / limit * 100)
  warning: boolean
  critical: boolean
  shouldAutocompact: boolean // used >= limit * AUTOCOMPACT_TRIGGER_RATIO
}

/** Count tokens for an array of OpenAI-style tool schemas. */
export function countToolSchemas(tools: unknown[] | null | undefined): number {
  if (!tools || tools.length === 0) return 0
  // JSON roundtrip approximates what the provider will serialize into
  // the system prompt. Good enough for budget accounting.
  return estimateTokens(JSON.stringify(tools))
}

/** Export the heuristic so other modules can reuse it without
 *  constructing a full engine. Used by useContextBreakdown.  */
export function countTextTokens(text: string): number {
  return estimateTokens(text)
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

// ─── Message budget ──────────────────────────────────────────────
// How many tokens the conversation history may occupy: the model limit
// minus the *real* fixed overhead of the request (system prompt, eager
// tool schemas, injected memory) and a reservation for the model's reply.
//
// Replaces the old blind `limit * 0.60`, which was wrong both ways:
//   - small models (8k) — overhead was NOT subtracted, so system prompt +
//     tools + memory could push the request past the real window (API
//     "context length exceeded");
//   - large models (200k/1M) — a flat 40% was reserved no matter what, so
//     80k+ sat unused and the loop compacted far earlier than needed.
// Pairs with the real tokenizer (v2.12.12): the counts feeding this are
// now exact, so the budget is too. assemble() still guarantees the newest
// message survives even when overhead leaves a near-zero budget.

/** Small reserve for request bits not modeled explicitly: language priming
 *  pair, per-turn system reminders (working memory, language, planning),
 *  and the persistent-memory tail loaded after the budget is computed. */
export const BUDGET_SAFETY_SLACK = 256

export function computeMessageBudget(
  limit: number,
  overhead: {
    systemTokens?: number
    toolTokens?: number
    memoryTokens?: number
    responseReserve?: number
  },
): number {
  const used =
    (overhead.systemTokens || 0) +
    (overhead.toolTokens || 0) +
    (overhead.memoryTokens || 0) +
    (overhead.responseReserve || 0) +
    BUDGET_SAFETY_SLACK
  // Clamp to [0, limit]. A near-zero budget is fine — assemble() always
  // keeps the most recent message regardless, which is the correct
  // degradation when overhead alone nearly fills a tiny window.
  return Math.max(0, Math.min(limit - used, limit))
}
