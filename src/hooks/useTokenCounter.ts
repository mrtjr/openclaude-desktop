import { useMemo } from 'react'
import { createContextEngine, getModelContextLimit } from '../services/contextEngine'
import { useTokenizerReady } from './useTokenizerReady'
import type { Conversation } from '../types'

const engine = createContextEngine()

interface TokenInfo {
  used: number
  limit: number
  percentage: number
  warning: boolean  // > 80%
  critical: boolean // > 95%
}

export function useTokenCounter(
  activeConv: Conversation | undefined,
  model: string,
  inputText: string
): TokenInfo {
  // Re-render + recompute once the real tokenizer finishes loading so the
  // counter sharpens from the char/4 heuristic to real BPE counts.
  const tokenizerReady = useTokenizerReady()
  return useMemo(() => {
    const limit = getModelContextLimit(model)
    let used = 0

    if (activeConv) {
      used = engine.getTokenCount(activeConv.messages)
    }

    // Add current input
    if (inputText) {
      used += engine.countTokens(inputText)
    }

    const percentage = limit > 0 ? Math.round((used / limit) * 100) : 0

    return {
      used,
      limit,
      percentage,
      warning: percentage > 80,
      critical: percentage > 95,
    }
  }, [activeConv?.messages, model, inputText, tokenizerReady])
}

/** Format token count for display: "1.2k" / "128k" */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}
