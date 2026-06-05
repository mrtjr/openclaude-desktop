// ─── useContextBreakdown ────────────────────────────────────────────
//
// Extended token accounting for the Context Window panel. Returns the
// same shape `useTokenCounter` does plus per-category figures
// (messages / system prompt / tools / deferred / skills / memory /
// autocompact buffer / free) so the UI can render a Claude-style
// stacked bar and breakdown list.
//
// Keeps `useTokenCounter` untouched for other callers (simple scalar
// used/limit counter in the input footer).

import { useMemo } from 'react'
import {
  createContextEngine,
  getModelContextLimit,
  countToolSchemas,
  countTextTokens,
  AUTOCOMPACT_BUFFER_RATIO,
  AUTOCOMPACT_TRIGGER_RATIO,
  type ContextBreakdown,
} from '../services/contextEngine'
import { useTokenizerReady } from './useTokenizerReady'
import type { Conversation } from '../types'

const engine = createContextEngine()

export interface ContextBreakdownInputs {
  activeConv: Conversation | undefined
  model: string
  inputText: string
  systemPrompt: string
  memoryText: string
  eagerTools: unknown[]
  deferredToolNames: Array<{ name: string; description: string }>
  deferredToolSchemas: unknown[]  // full schemas, counted as BUDGET only
  skillHeaders?: string  // joined "name: desc" lines
}

export function useContextBreakdown(i: ContextBreakdownInputs): ContextBreakdown {
  const {
    activeConv, model, inputText, systemPrompt, memoryText,
    eagerTools, deferredToolNames, deferredToolSchemas, skillHeaders = '',
  } = i

  // Sharpen every category from char/4 to real BPE counts once loaded.
  const tokenizerReady = useTokenizerReady()
  return useMemo(() => {
    const limit = getModelContextLimit(model)

    // Messages: conv history + current input
    let messages = 0
    if (activeConv) messages += engine.getTokenCount(activeConv.messages)
    if (inputText) messages += countTextTokens(inputText)

    // System prompt: includes provider label, agent directives, language rule
    const systemPromptTokens = countTextTokens(systemPrompt)

    // Memory: persistent facts + context summary
    const memory = countTextTokens(memoryText)

    // Tools — eager schemas go into the request, deferred schemas are
    // budget accounting (not actually sent unless the model calls
    // tool_search; even then, only a subset arrives).
    const systemTools = countToolSchemas(eagerTools)
    const systemToolsDeferred = countToolSchemas(deferredToolSchemas)

    // Deferred manifest: the "name + desc" list that DOES get injected
    // into the system prompt for deferred tools. Small but non-zero.
    const deferredManifestTokens = deferredToolNames.length > 0
      ? countTextTokens(
          deferredToolNames
            .map((t) => `- ${t.name} — ${t.description}`)
            .join('\n'),
        )
      : 0

    // MCP: not implemented yet, placeholder for future integration.
    const mcpTools = 0
    const mcpToolsDeferred = 0

    // Skills: currently just a line-count of whatever headers the
    // caller provides (persona/skill system is still being designed).
    const skills = countTextTokens(skillHeaders)

    // Autocompact buffer: reserved headroom for the compaction call
    const autocompactBuffer = Math.floor(limit * AUTOCOMPACT_BUFFER_RATIO)

    const used =
      messages +
      systemPromptTokens +
      memory +
      systemTools +
      mcpTools +
      skills +
      deferredManifestTokens

    const total = used + autocompactBuffer
    const free = Math.max(0, limit - total)
    const percentage = limit > 0 ? Math.round((used / limit) * 100) : 0
    const usedRatio = limit > 0 ? used / limit : 0

    return {
      messages,
      systemPrompt: systemPromptTokens + deferredManifestTokens,
      memory,
      systemTools,
      systemToolsDeferred,
      mcpTools,
      mcpToolsDeferred,
      skills,
      autocompactBuffer,
      free,
      used,
      total,
      limit,
      percentage,
      warning: usedRatio > 0.80,
      critical: usedRatio > 0.95,
      shouldAutocompact: usedRatio >= AUTOCOMPACT_TRIGGER_RATIO,
    }
  }, [
    activeConv?.messages, model, inputText, systemPrompt, memoryText,
    eagerTools, deferredToolNames, deferredToolSchemas, skillHeaders,
    tokenizerReady,
  ])
}
