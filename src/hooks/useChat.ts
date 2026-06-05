import { useState, useRef, useCallback, useEffect } from 'react'
import type { Message, ToolResult, Conversation, AppSettings } from '../types'
import { TOOLS, AGENT_SAFETY_LIMIT, NORMAL_SAFETY_LIMIT, IDLE_STEP_THRESHOLD } from '../constants/tools'
import { AGENT_SYSTEM_PROMPT, PLANNING_MODE_PROMPT, LANGUAGE_RULE, LANGUAGE_PRIMING, LANGUAGE_REMINDER } from '../constants/prompts'
import { partitionTools, renderDeferredManifest, decideDeferral } from '../services/toolDeferral'
import { generateId, isSmallModel } from '../utils/formatting'
import { sanitizeReasoningLeaksSafe, StreamingSanitizer, emptyReplyNotice } from '../utils/sanitizers'
import { classifyProviderError, humanizeProviderError } from '../utils/providerErrors'
import { resolveTurnUsage } from '../utils/usage'
import { createContextEngine, getModelContextLimit, countToolSchemas, computeMessageBudget } from '../services/contextEngine'
import type { ProviderConfig } from './useProviderConfig'

// The engine is pure and stateless — create once at module load.
const contextEngine = createContextEngine()

interface UseChatOptions {
  settings: AppSettings
  providerConfig: ProviderConfig
  activeConvId: string | null
  conversationsRef: React.MutableRefObject<Conversation[]>
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  isAgentMode: boolean
  executeTool: (name: string, args: Record<string, any>) => Promise<string>
  speakText: (text: string) => void
  showToast: (message: string) => void
  onProviderSuccess?: () => void
  onProviderError?: (error: string) => void
  onUsage?: (inputTokens: number, outputTokens: number) => void
}

export function useChat({
  settings,
  providerConfig,
  activeConvId,
  conversationsRef,
  setConversations,
  isAgentMode,
  executeTool,
  speakText,
  showToast,
  onProviderSuccess,
  onProviderError,
  onUsage,
}: UseChatOptions) {
  // Use refs for callback props to avoid stale closures in useCallback
  const onProviderSuccessRef = useRef(onProviderSuccess)
  onProviderSuccessRef.current = onProviderSuccess
  const onProviderErrorRef = useRef(onProviderError)
  onProviderErrorRef.current = onProviderError
  const onUsageRef = useRef(onUsage)
  onUsageRef.current = onUsage
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [agentSteps, setAgentSteps] = useState(0)
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)

  const stopRequestedRef = useRef(false)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  const sendingRef = useRef(false)
  // Models we've learned (this session) don't support tool use. When a
  // request fails with the specific "no endpoints support tool use" error
  // from OpenRouter (or equivalent), we remember the model+provider pair
  // and omit `tools` from the next request for it. Persisted in
  // localStorage so the flag survives reloads — the user can clear it
  // from Settings if they switch to a tool-capable endpoint.
  const noToolsModelsRef = useRef<Set<string>>(
    (() => {
      try {
        const raw = localStorage.getItem('openclaude-no-tools-models')
        return new Set(raw ? JSON.parse(raw) : [])
      } catch { return new Set<string>() }
    })()
  )
  const markNoTools = (provider: string, model: string) => {
    const key = `${provider}:${model}`
    noToolsModelsRef.current.add(key)
    try {
      localStorage.setItem('openclaude-no-tools-models', JSON.stringify([...noToolsModelsRef.current]))
    } catch { /* quota */ }
  }
  const hasNoTools = (provider: string, model: string) =>
    noToolsModelsRef.current.has(`${provider}:${model}`)

  // Cleanup stream listener on unmount
  useEffect(() => {
    return () => {
      streamCleanupRef.current?.()
      streamCleanupRef.current = null
    }
  }, [])

  const stopAgent = useCallback(() => {
    stopRequestedRef.current = true
    sendingRef.current = false
    setIsLoading(false)
    setIsStreaming(false)
    setStreamingText('')
    setStreamingConvId(null)
    if (streamCleanupRef.current) {
      streamCleanupRef.current()
      streamCleanupRef.current = null
    }
    window.electron.abortStream().catch((e: any) => console.warn('[useChat] abort error:', e))
    showToast('Agente interrompido pelo usuário.')
  }, [showToast])

  const sendMessage = useCallback(async (inputText: string, overrideConvId?: string) => {
    // Prefer an explicit conversation id when provided (e.g. scheduled
    // tasks firing in batch, where several `newConversation()` calls
    // landed before the React state flushed — without an override the
    // ref only has the last id, so every task's prompt would land in
    // the same conversation). Fall back to the ref otherwise.
    const convId = overrideConvId ?? activeConvIdRef.current
    console.log('[useChat] sendMessage called:', { inputText: inputText.substring(0, 50), isLoading, convId })
    if (!inputText.trim() || isLoading || !convId) {
      console.log('[useChat] EARLY RETURN:', { emptyInput: !inputText.trim(), isLoading, noActiveConv: !convId })
      return
    }
    // Deduplication guard
    if (sendingRef.current) {
      console.log('[useChat] DEDUP: already sending')
      return
    }
    sendingRef.current = true

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date()
    }

    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c
      const messages = [...c.messages, userMsg]
      return {
        ...c,
        title: c.messages.length === 0 ? inputText.trim().slice(0, 40) : c.title,
        messages
      }
    }))

    setIsLoading(true)
    setStreamingConvId(convId)
    setAgentSteps(0)
    stopRequestedRef.current = false

    const { provider: finalProvider, model: finalModel, apiKey: finalApiKey, isNotOllama, modalHostname, customBaseUrl } = providerConfig

    // Session analytics tracker
    const sessionTracker = {
      startTime: Date.now(),
      toolCalls: 0,
      errors: 0,
      circuitBreaks: 0,
      toolsUsed: {} as Record<string, number>,
      agentMode: isAgentMode,
      agentSteps: 0,
      agentCompleted: false,
      model: finalModel,
      provider: finalProvider,
      responseTimes: [] as number[],
    }

    try {
      const conv = conversationsRef.current.find(c => c.id === convId)
      const lang = settings.language || 'pt'

      let systemPrompt = settings.systemPrompt || ''
      // Inject provider context so the model knows where it's running
      const providerLabel = isNotOllama
        ? `${finalProvider.charAt(0).toUpperCase() + finalProvider.slice(1)} (modelo: ${finalModel})`
        : `Ollama localmente no computador do usuário (modelo: ${finalModel})`
      // Handle both new default ("chamado OpenClaude.") and old default ("rodando via Ollama")
      if (systemPrompt.includes('rodando via Ollama')) {
        systemPrompt = systemPrompt.replace(/rodando via Ollama[^.]*\.?/, `rodando via ${providerLabel}.`)
      } else if (systemPrompt.includes('chamado OpenClaude.')) {
        systemPrompt = systemPrompt.replace('chamado OpenClaude.', `chamado OpenClaude, rodando via ${providerLabel}.`)
      } else if (systemPrompt.includes('chamado OpenClaude,')) {
        systemPrompt = systemPrompt.replace(/chamado OpenClaude,[^.]*\./, `chamado OpenClaude, rodando via ${providerLabel}.`)
      } else {
        // Fallback: prepend provider context if custom prompt doesn't match known patterns
        systemPrompt = `[Provider: ${providerLabel}]\n${systemPrompt}`
      }
      if (isAgentMode) {
        systemPrompt = AGENT_SYSTEM_PROMPT[lang] + (systemPrompt ? (lang === 'pt' ? "\n\nInstruções Adicionais:\n" : "\n\nAdditional Instructions:\n") + systemPrompt : "")
      }
      systemPrompt += LANGUAGE_RULE[lang]

      // Tool deferral (v2.12.6; auto-decided since v2.12.11): move
      // rarely-used tools out of the request schema list into a compact
      // name/desc manifest in the system prompt; the model calls
      // `tool_search` to pull full schemas on demand. The decision is per
      // turn and per model — see decideDeferral (context-pressure heuristic).
      const deferral = decideDeferral(
        settings.toolDeferralMode,
        getModelContextLimit(finalModel),
        countToolSchemas(TOOLS as any),
      )
      const deferralEnabled = deferral.enabled
      const toolPartition = partitionTools(TOOLS as any, deferralEnabled)
      if (deferralEnabled && toolPartition.deferredNames.length > 0) {
        systemPrompt += '\n\n' + renderDeferredManifest(toolPartition.deferredNames, lang)
        console.log(`[useChat] tool deferral ON — ${deferral.reason} | eager ${toolPartition.eagerTokens}t, ~${toolPartition.deferredTokens}t deferred`)
      } else {
        console.log(`[useChat] tool deferral OFF — ${deferral.reason}`)
      }

      const systemMessages: any[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []

      // Rebuild history in API format
      const history: any[] = []
      if (conv) {
        for (const m of conv.messages) {
          history.push({
            role: m.role,
            content: m.content,
            ...(m.toolCalls ? { tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
            })) } : {})
          })
          if (m.toolResults) {
            for (const tr of m.toolResults) {
              history.push({ role: 'tool', tool_call_id: tr.toolCallId, content: tr.result })
            }
          }
        }
      }
      history.push({ role: 'user', content: userMsg.content })

      // ─── Context assembly via ContextEngine ─────────────────────
      // Strategy: prefer token-budget truncation over raw message count.
      //   1. Compute the message budget = model limit − the REAL request
      //      overhead (system prompt + eager tool schemas + memory) − a
      //      reservation for the reply. See computeMessageBudget; replaces
      //      the old blind `limit * 0.60` that overflowed small models and
      //      starved large ones. Exact now that token counts are real (v2.12.12).
      //   2. engine.assemble() walks back from newest keeping messages
      //      until the budget is exhausted (and always keeps the newest).
      //   3. If any messages were dropped, summarise the oldest chunk.
      //
      // This replaces the previous fixed 50-message cap, which was both
      // too aggressive on large-context models (Gemini 1M) and too loose
      // on small ones (gpt-4 8k).
      const modelLimit = getModelContextLimit(finalModel)
      let contextSummary = conv?.contextSummary || ''
      const tokenBudget = computeMessageBudget(modelLimit, {
        systemTokens: contextEngine.countTokens(systemPrompt),
        // Schemas actually sent this turn: the eager subset (+ tool_search)
        // when deferral is on, otherwise the full tool set.
        toolTokens: deferralEnabled ? toolPartition.eagerTokens : countToolSchemas(TOOLS as any),
        // Known memory so far (the running summary). Persistent facts are
        // loaded later and covered by BUDGET_SAFETY_SLACK + the reserve.
        memoryTokens: contextEngine.countTokens(contextSummary),
        // Reserve the reply allocation so the prompt+completion never exceed
        // the window. Floor at 2k for providers that ignore max_tokens.
        responseReserve: settings.maxTokens || 2048,
      })
      const historyForEngine = history as any[]
      const assembled = contextEngine.assemble(historyForEngine, tokenBudget)
      let trimmedHistory = assembled
      // Drop count is defined strictly by the token budget now. The old
      // parallel 50-message cap was dead code — kept after the token
      // engine landed but never removed. We relied on Math.max(a, b)
      // which made the budget effectively min(50msg, 60% tokens),
      // silently ignoring the token setting on most conversations.
      const droppedCount = history.length - assembled.length

      if (droppedCount > 0) {
        const oldMessages = history.slice(0, droppedCount)
        trimmedHistory = history.slice(droppedCount)

        try {
          const compactResult = await window.electron.compactContext({
            messages: oldMessages,
            model: finalModel,
            language: lang,
            provider: settings.provider,
          })
          if (compactResult.summary) {
            contextSummary = (contextSummary ? contextSummary + '\n\n' : '') + compactResult.summary
            if (contextSummary.length > 2000) {
              contextSummary = contextSummary.slice(-2000)
            }
            setConversations(prev => prev.map(c =>
              c.id !== convId ? c : { ...c, contextSummary }
            ))
          }
        } catch (e) {
          console.warn('[useChat] context compaction failed, using truncation:', e)
        }
      }

      // Inject memory context
      const memoryContext: string[] = []
      if (contextSummary) {
        memoryContext.push(`[CONTEXT SUMMARY — earlier conversation]\n${contextSummary}`)
      }
      if (settings.memoryEnabled) {
        try {
          const mem = await window.electron.loadMemory()
          const parts: string[] = []
          if (mem.facts?.length) parts.push(`Facts: ${mem.facts.join('; ')}`)
          if (mem.preferences?.length) parts.push(`Preferences: ${mem.preferences.join('; ')}`)
          if (mem.projects?.length) parts.push(`Projects: ${mem.projects.join('; ')}`)
          if (parts.length > 0) {
            memoryContext.push(`[PERSISTENT MEMORY]\n${parts.join('\n')}`)
          }
        } catch (e) { console.warn('[useChat] memory load error:', e) }
      }

      // Language priming
      const priming = LANGUAGE_PRIMING[lang]
      const primingMessages = [
        { role: 'user', content: priming.user },
        { role: 'assistant', content: priming.assistant }
      ]

      const memoryMessages = memoryContext.length > 0
        ? [{ role: 'system', content: memoryContext.join('\n\n') }]
        : []

      let continueLoop = true
      let allMessages: any[] = [...systemMessages, ...memoryMessages, ...primingMessages, ...trimmedHistory]
      const cloudStreamingSupported = ['openai', 'openrouter', 'modal', 'anthropic'].includes(finalProvider)
      const useStreaming = isNotOllama ? (cloudStreamingSupported && settings.streamingEnabled) : settings.streamingEnabled
      let steps = 0
      let idleSteps = 0
      const recentToolCalls: string[] = []
      let activeMemory = conv?.workingMemory || null
      const safetyLimit = isAgentMode ? AGENT_SAFETY_LIMIT : NORMAL_SAFETY_LIMIT
      // Per-turn flag for the tools-unsupported auto-retry. Starts from the
      // persisted record, so a model we already know can't take tools never
      // gets tools sent again.
      let toolsDisabledForThisTurn = hasNoTools(finalProvider, finalModel)
      // v2.12.8: after `plan_tasks` runs, weaker models (free OpenRouter tier,
      // small Ollama) frequently return an empty assistant turn — they
      // treat "I wrote the plan" as completion. Track the flag so the
      // next iteration injects a one-shot nudge telling the model to
      // execute step 1. Cleared after it fires.
      let nudgeExecutePlan = false
      // Count of empty-response retries already spent this send. Capped
      // at 1 to avoid infinite "please continue" loops on a truly dead
      // provider. Reset per sendMessage.
      let emptyRetriesUsed = 0
      const MAX_EMPTY_RETRIES = 1
      // Transient-failure auto-retry (rate limit / overloaded / network blip).
      // One attempt with a short backoff, mirroring the tools-unsupported
      // recovery below. Reset per sendMessage.
      let transientRetriesUsed = 0
      const MAX_TRANSIENT_RETRIES = 1
      const isToolsUnsupportedError = (msg: string | undefined): boolean => {
        if (!msg) return false
        const m = msg.toLowerCase()
        // OpenRouter explicit message + common alternatives from OpenAI-compat
        // backends that proxy models without tool-calling. Kept as a short,
        // concrete list instead of a loose regex to avoid false positives
        // on generic "error" or "not supported" text.
        return m.includes('no endpoints found that support tool use')
          || m.includes("doesn't support tools")
          || m.includes('does not support tools')
          || m.includes('does not support tool use')
          || m.includes('tool use is not supported')
          || m.includes('tool_use is not supported')
      }

      console.log('[useChat] Starting chat loop:', { provider: finalProvider, model: finalModel, useStreaming, messageCount: allMessages.length })

      while (continueLoop && steps < safetyLimit) {
        if (stopRequestedRef.current) break
        steps++
        sessionTracker.agentSteps = steps
        setAgentSteps(steps)
        const stepStartTime = Date.now()

        const requestMessages = [...allMessages]
        if (activeMemory && isAgentMode) {
          requestMessages.push({
            role: 'system',
            content: `[URGENT WORKING MEMORY STATE]\nGoal: ${activeMemory.current_goal || 'None'}\nDone: ${activeMemory.done_steps || 'None'}\nPending: ${activeMemory.open_tasks || 'None'}`
          })
        }

        if (settings.permissionLevel === 'planning') {
          requestMessages.push({ role: 'system', content: PLANNING_MODE_PROMPT[lang] })
        }

        // One-shot nudge after plan_tasks so the model actually executes
        // the plan instead of "planning is done, I'm finished". Injected
        // only for the turn right after plan_tasks; clears on emit.
        if (nudgeExecutePlan) {
          requestMessages.push({
            role: 'system',
            content: lang === 'en'
              ? '[CONTINUE] You just created a task plan. NOW execute step 1 by calling the appropriate tool (e.g. web_search, read_file, execute_command). Do NOT stop and wait for the user — the user expects the plan to be carried out in this same turn. If a step produces results worth reporting, call update_task_status and move to the next one.'
              : '[CONTINUAR] Você acabou de criar um plano de tarefas. AGORA execute o passo 1 chamando a ferramenta apropriada (ex: web_search, read_file, execute_command). NÃO pare esperando o usuário — o usuário espera que o plano seja executado nesta mesma rodada. Se um passo produzir resultado relevante, chame update_task_status e avance para o próximo.',
          })
          nudgeExecutePlan = false
        }

        if (isAgentMode && isSmallModel(finalModel)) {
          requestMessages.push({
            role: 'system',
            content: `[CRITICAL AGENT DIRECTIVE]\nYou are an autonomous Agent with unlimited steps. You MUST keep calling tools until the user's goal is 100% complete.\n- If the goal is NOT fully done, you MUST output a tool call. Do NOT output a text-only response.\n- Use 'update_working_memory' every few steps.\n- Only give a final text answer when every single subtask is done.\n- NEVER say "I'll do X next" — just DO it by calling the tool NOW.`
          })
        }

        requestMessages.push({ role: 'system', content: LANGUAGE_REMINDER[lang] })

        if (useStreaming) {
          // ─── Streaming path ────────────────────────────────
          let accumulated = ''
          let displayText = ''
          const sanitizer = new StreamingSanitizer()
          let toolCallsData: any[] = []
          let finishReason = ''
          // Usage reported by the provider (OpenAI stream_options.include_usage
          // or Anthropic message_start/message_delta). Null when the provider
          // doesn't support it (e.g. Ollama local, Gemini stream path).
          let streamUsage: { prompt_tokens: number; completion_tokens: number } | null = null
          setIsStreaming(true)
          setStreamingText('')

          try {
          await new Promise<void>((resolve, reject) => {
            const cleanup = window.electron.onStreamChunk((chunk: any) => {
              // Handle done event — check for error inside done chunk
              if (chunk.done) {
                cleanup()
                streamCleanupRef.current = null
                if (chunk.error) {
                  reject(new Error(chunk.error))
                } else {
                  resolve()
                }
                return
              }
              if (chunk.error) { cleanup(); streamCleanupRef.current = null; reject(new Error(chunk.error)); return }
              // Capture usage if the provider sent it (OpenAI-compat final chunk
              // or Anthropic synthetic chunk). Uniform shape {prompt_tokens, completion_tokens}.
              if (chunk.usage && typeof chunk.usage === 'object') {
                streamUsage = {
                  prompt_tokens: chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0,
                  completion_tokens: chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0,
                }
              }
              const delta = chunk.choices?.[0]?.delta
              if (delta) {
                if (delta.content) {
                  accumulated += delta.content
                  // Sanitize reasoning leaks in real-time
                  const safe = sanitizer.process(delta.content)
                  if (safe) { displayText += safe; setStreamingText(displayText) }
                }
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0
                    if (!toolCallsData[idx]) toolCallsData[idx] = { id: tc.id || '', function: { name: '', arguments: '' } }
                    if (tc.id) toolCallsData[idx].id = tc.id
                    if (tc.function?.name) toolCallsData[idx].function.name += tc.function.name
                    if (tc.function?.arguments) toolCallsData[idx].function.arguments += tc.function.arguments
                  }
                }
              }
              const fr = chunk.choices?.[0]?.finish_reason
              if (fr) finishReason = fr
            })
            streamCleanupRef.current = cleanup

            const toolsForRequest = toolsDisabledForThisTurn ? [] : (deferralEnabled ? [...toolPartition.eager, toolPartition.metaTool] as any[] : TOOLS)
            const streamCall = isNotOllama
              ? window.electron.providerChatStream({
                  provider: finalProvider, apiKey: finalApiKey, model: finalModel,
                  messages: requestMessages, tools: toolsForRequest,
                  temperature: settings.temperature, max_tokens: settings.maxTokens,
                  modalHostname, customBaseUrl
                })
              : window.electron.ollamaChatStream({
                  model: finalModel, messages: requestMessages, tools: toolsForRequest,
                  temperature: settings.temperature, max_tokens: settings.maxTokens
                })
            streamCall.catch((err: any) => { cleanup(); streamCleanupRef.current = null; reject(err) })
          })
          } catch (err: any) {
            // Tools-unsupported auto-recovery. Some providers (OpenRouter
            // especially) only expose a tool-capable endpoint for some
            // models; if the selected model has no such endpoint the whole
            // request 404s before a single chunk arrives. Catch that, mark
            // the model as no-tools (persist), rewind one step, and let
            // the loop re-send without `tools` so the user at least gets
            // a plain chat response.
            if (!toolsDisabledForThisTurn && isToolsUnsupportedError(err?.message)) {
              markNoTools(finalProvider, finalModel)
              toolsDisabledForThisTurn = true
              setIsStreaming(false)
              setStreamingText('')
              showToast(lang === 'en'
                ? `"${finalModel}" doesn't support tool use — retrying without tools.`
                : `"${finalModel}" não suporta tool use — refazendo sem ferramentas.`)
              steps-- // don't count the failed attempt
              continue
            }
            // Transient failure: back off and retry once. Guarded by
            // `!accumulated` so we never re-send after partial output already
            // streamed (no double output / double billing).
            const cls = classifyProviderError(err?.message)
            if (cls.retryable && transientRetriesUsed < MAX_TRANSIENT_RETRIES && !accumulated) {
              transientRetriesUsed++
              setIsStreaming(false)
              setStreamingText('')
              showToast(humanizeProviderError(err?.message, lang) + (lang === 'en' ? ' (retrying…)' : ' (tentando de novo…)'))
              await new Promise(r => setTimeout(r, 1500))
              steps-- // don't count the failed attempt
              continue
            }
            throw err
          }

          setIsStreaming(false)
          setStreamingText('')

          // If the user pressed Stop during the stream, bail out before we
          // dispatch any of the partial tool calls that accumulated. Without
          // this check the loop would still run `processToolCalls` on
          // `toolCallsData`, which can include destructive tools (write_file,
          // exec_command) the user explicitly asked to cancel.
          if (stopRequestedRef.current) {
            continueLoop = false
            break
          }

          // Flush sanitizer and sanitize final accumulated text.
          // Safety net (v2.12.7): if the sanitizer would wipe the entire
          // reply (model wrapped everything in <think>… or stream ended
          // mid-thinking-tag), prefer the raw text over an empty message.
          // A response with visible reasoning is still better than the
          // silent "chat interrupted" symptom the user was seeing when a
          // plan_tasks turn was followed by an all-reasoning reply.
          const remaining = sanitizer.flush()
          if (remaining) displayText += remaining
          // Encapsulated "never blank" invariant (see sanitizeReasoningLeaksSafe).
          accumulated = sanitizeReasoningLeaksSafe(accumulated)
          console.log('[useChat] Stream completed:', { accumulatedLen: accumulated.length, toolCalls: toolCallsData.length, finishReason })
          onProviderSuccessRef.current?.()

          // ─── Per-turn usage reporting ────────────────────────────
          // Preferred: real numbers from the provider (stream_options.include_usage
          // for OpenAI-compat, message_start+message_delta for Anthropic).
          // Fallback: heuristic on *this turn only* — requestMessages for input
          // and `accumulated` for output. Never sum across turns (was the bug).
          try {
            const usageFn = onUsageRef.current
            if (usageFn) {
              const u = resolveTurnUsage(streamUsage, requestMessages, accumulated)
              usageFn(u.inputTokens, u.outputTokens)
            }
          } catch (e) { console.warn('[useChat] usage report error:', e) }

          if (toolCallsData.length > 0 && toolCallsData[0]?.function?.name) {
            const { message: thinkingMsg, shouldContinue } = await processToolCalls(
              convId, accumulated, toolCallsData.map(tc => ({
                id: tc.id,
                function: { name: tc.function.name, arguments: tc.function.arguments }
              })),
              recentToolCalls, activeMemory, idleSteps, sessionTracker
            )
            // Pick up any working-memory update so subsequent agent loops
            // see the new state. Earlier versions tried to parse
            // `wmResult.result` as JSON, but that field is a constant
            // confirmation string ("[SYSTEM]: Working memory updated…"),
            // so the parse always threw and activeMemory never refreshed
            // during a streaming turn. Read the arguments straight from
            // the tool call instead — those ARE JSON.
            const wmCall = toolCallsData.find(tc => tc?.function?.name === 'update_working_memory')
            if (wmCall?.function?.arguments) {
              try { activeMemory = JSON.parse(wmCall.function.arguments) } catch (e) { console.warn('[useChat] working memory parse:', e) }
            }
            // v2.12.8: arm the "now execute" nudge whenever plan_tasks was
            // just written. Fires once on the next iteration.
            if (toolCallsData.some(tc => tc?.function?.name === 'plan_tasks')) {
              nudgeExecutePlan = true
            }
            idleSteps = shouldContinue.idleSteps
            if (!shouldContinue.continue) continueLoop = false

            setConversations(prev => prev.map(c =>
              c.id !== convId ? c : { ...c, messages: [...c.messages, thinkingMsg] }
            ))

            allMessages = [
              ...allMessages,
              { role: 'assistant', content: accumulated, tool_calls: toolCallsData },
              ...(thinkingMsg.toolResults || []).map(tr => ({
                role: 'tool', tool_call_id: tr.toolCallId, content: tr.result
              }))
            ]
          } else {
            // Final fallback: if BOTH raw and sanitized are empty, the
            // model actually returned nothing (max_tokens=0, network
            // truncation, provider glitch). Surface a human-readable
            // note instead of a blank bubble so the user sees the
            // session ended rather than "something broke silently".
            const safeContent = accumulated.trim().length > 0
              ? accumulated
              : emptyReplyNotice(lang)
            const finalMsg: Message = {
              id: generateId(), role: 'assistant', content: safeContent, timestamp: new Date()
            }
            setConversations(prev => prev.map(c =>
              c.id !== convId ? c : { ...c, messages: [...c.messages, finalMsg] }
            ))
            if (accumulated) speakText(accumulated)
            sessionTracker.agentCompleted = true
            continueLoop = false
          }

          if (finishReason === 'stop' && !(toolCallsData.length > 0 && toolCallsData[0]?.function?.name)) {
            sessionTracker.agentCompleted = true
            continueLoop = false
          }

        } else {
          // ─── Non-streaming path ────────────────────────────
          const toolsForRequest = toolsDisabledForThisTurn ? [] : (deferralEnabled ? [...toolPartition.eager, toolPartition.metaTool] as any[] : TOOLS)
          let response: any
          if (isNotOllama) {
            response = await window.electron.providerChat({
              provider: finalProvider, apiKey: finalApiKey, model: finalModel,
              messages: requestMessages, tools: toolsForRequest,
              temperature: settings.temperature, max_tokens: settings.maxTokens,
              modalHostname, customBaseUrl
            })
          } else {
            response = await window.electron.ollamaChat({
              model: finalModel, messages: requestMessages, tools: toolsForRequest,
              temperature: settings.temperature, max_tokens: settings.maxTokens
            })
          }

          if (response.error) {
            // Mirror the streaming path's auto-retry for tools-unsupported
            // errors (see detailed comment above).
            if (!toolsDisabledForThisTurn && isToolsUnsupportedError(response.error)) {
              markNoTools(finalProvider, finalModel)
              toolsDisabledForThisTurn = true
              showToast(lang === 'en'
                ? `"${finalModel}" doesn't support tool use — retrying without tools.`
                : `"${finalModel}" não suporta tool use — refazendo sem ferramentas.`)
              steps--
              continue
            }
            // Transient failure auto-retry (mirrors the streaming path).
            const cls = classifyProviderError(response.error)
            if (cls.retryable && transientRetriesUsed < MAX_TRANSIENT_RETRIES) {
              transientRetriesUsed++
              showToast(humanizeProviderError(response.error, lang) + (lang === 'en' ? ' (retrying…)' : ' (tentando de novo…)'))
              await new Promise(r => setTimeout(r, 1500))
              steps--
              continue
            }
            throw new Error(response.error)
          }
          onProviderSuccessRef.current?.()

          // Same guard as the streaming branch — if the user pressed Stop
          // while the non-streaming request was in flight, don't dispatch
          // any tool calls the model returned.
          if (stopRequestedRef.current) { continueLoop = false; break }

          const choice = response.choices?.[0]
          if (!choice) break

          const assistantMsg = choice.message
          // Sanitize reasoning leaks from non-streaming response. Mirror
          // the streaming safety net: if sanitizing would empty the reply
          // (all-reasoning output), keep the raw text so we never save
          // a blank message after a tool-call turn.
          if (assistantMsg.content) {
            assistantMsg.content = sanitizeReasoningLeaksSafe(assistantMsg.content)
          }

          // Per-turn usage — the non-streaming path previously reported none,
          // so the cost dashboard showed $0 for non-streaming providers. Prefer
          // the provider's reported usage; else estimate via the real tokenizer.
          try {
            const usageFn = onUsageRef.current
            if (usageFn) {
              const u = resolveTurnUsage(response.usage, requestMessages, assistantMsg.content || '')
              usageFn(u.inputTokens, u.outputTokens)
            }
          } catch (e) { console.warn('[useChat] usage report error (non-stream):', e) }

          const toolCalls = assistantMsg.tool_calls

          if (toolCalls && toolCalls.length > 0) {
            const normalizedTCs = toolCalls.map((tc: any) => ({
              id: tc.id,
              function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                  ? tc.function.arguments
                  : JSON.stringify(tc.function.arguments || {})
              }
            }))

            const { message: thinkingMsg, shouldContinue } = await processToolCalls(
              convId, assistantMsg.content || '', normalizedTCs,
              recentToolCalls, activeMemory, idleSteps, sessionTracker
            )
            idleSteps = shouldContinue.idleSteps
            if (!shouldContinue.continue) continueLoop = false

            setConversations(prev => prev.map(c =>
              c.id !== convId ? c : { ...c, messages: [...c.messages, thinkingMsg] }
            ))

            allMessages = [
              ...allMessages,
              { role: 'assistant', content: assistantMsg.content || '', tool_calls: toolCalls },
              ...(thinkingMsg.toolResults || []).map(tr => ({
                role: 'tool', tool_call_id: tr.toolCallId, content: tr.result
              }))
            ]
          } else {
            const raw = (assistantMsg.content || '').trim()
            const safeContent = raw.length > 0
              ? assistantMsg.content
              : emptyReplyNotice(lang)
            const finalMsg: Message = {
              id: generateId(), role: 'assistant',
              content: safeContent, timestamp: new Date()
            }
            setConversations(prev => prev.map(c =>
              c.id !== convId ? c : { ...c, messages: [...c.messages, finalMsg] }
            ))
            if (assistantMsg.content) speakText(assistantMsg.content)
            sessionTracker.agentCompleted = true
            continueLoop = false
          }

          if (choice.finish_reason === 'stop' && !(toolCalls && toolCalls.length > 0)) {
            sessionTracker.agentCompleted = true
            continueLoop = false
          }
        }

        sessionTracker.responseTimes.push(Date.now() - stepStartTime)
      }
    } catch (e: any) {
      console.error('[useChat] Error in sendMessage:', e)
      sessionTracker.errors++
      onProviderErrorRef.current?.(e.message || 'Unknown error')
      setIsStreaming(false)
      setStreamingText('')
      const errMsg: Message = {
        id: generateId(), role: 'assistant',
        content: humanizeProviderError(e.message, settings.language || 'pt'), timestamp: new Date()
      }
      setConversations(prev => prev.map(c =>
        c.id !== convId ? c : { ...c, messages: [...c.messages, errMsg] }
      ))
    } finally {
      sendingRef.current = false
      setIsLoading(false)
      setIsStreaming(false)
      setStreamingText('')
      setStreamingConvId(null)

      // Save session analytics
      if (settings.analyticsEnabled !== false) {
        const avgRT = sessionTracker.responseTimes.length > 0
          ? Math.round(sessionTracker.responseTimes.reduce((a, b) => a + b, 0) / sessionTracker.responseTimes.length)
          : 0
        window.electron.analyticsSaveSession({
          toolCalls: sessionTracker.toolCalls,
          errors: sessionTracker.errors,
          circuitBreaks: sessionTracker.circuitBreaks,
          toolsUsed: Object.entries(sessionTracker.toolsUsed).map(([name, count]) => ({ name, count })),
          agentMode: sessionTracker.agentMode,
          agentSteps: sessionTracker.agentSteps,
          agentCompleted: sessionTracker.agentCompleted,
          model: sessionTracker.model,
          provider: sessionTracker.provider,
          avgResponseTime: avgRT,
          duration: Date.now() - sessionTracker.startTime,
        }).catch((e: any) => console.warn('[useChat] analytics save error:', e))
      }

      // NOTE: usage reporting moved inside the stream loop so it fires per
      // turn with real provider numbers (stream_options.include_usage /
      // Anthropic message_delta). The previous implementation here summed
      // the ENTIRE conversation on every turn, causing exponential
      // double-counting and inflated costs in the dashboard.
    }
  }, [isLoading, providerConfig, settings, isAgentMode, conversationsRef, setConversations, executeTool, speakText, showToast])

  // Helper: process tool calls (shared between streaming and non-streaming)
  async function processToolCalls(
    convId: string,
    content: string,
    toolCallsRaw: { id: string; function: { name: string; arguments: string } }[],
    recentToolCalls: string[],
    activeMemory: Record<string, string> | null,
    idleSteps: number,
    tracker: any
  ): Promise<{ message: Message; shouldContinue: { continue: boolean; idleSteps: number } }> {
    const thinkingMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content,
      toolCalls: toolCallsRaw.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return { raw_invalid_json: tc.function.arguments } } })()
      })),
      timestamp: new Date()
    }

    const toolResults: ToolResult[] = []
    for (const tc of toolCallsRaw) {
      let args: Record<string, any> = {}
      let jsonError: string | null = null
      let result = ""
      const rawArgs = tc.function.arguments || '{}'

      try { args = JSON.parse(rawArgs) } catch (e: any) { jsonError = e.message }

      const callSignature = `${tc.function.name}:::${rawArgs}`

      if (jsonError) {
        result = `[SYSTEM INTERCEPT]: JSON Parse Error - ${jsonError}. You provided: ${rawArgs}. You MUST output strictly valid JSON syntax. Try calling the tool again with fixed JSON.`
        tracker.errors++
      } else if (tc.function.name === 'update_working_memory') {
        activeMemory = args as any
        setConversations(prev => prev.map(c => c.id !== convId ? c : { ...c, workingMemory: args }))
        result = `[SYSTEM]: Working memory updated successfully.`
      } else if (recentToolCalls.filter(c => c === callSignature).length >= 2) {
        result = `[SYSTEM INTERCEPT]: Circuit Breaker Triggered. You already called "${tc.function.name}" with these exact arguments ${recentToolCalls.filter(c => c === callSignature).length} times. This approach is not working. You MUST try a completely different strategy, use a different tool, or give a final text response. Do NOT repeat this call.`
        tracker.circuitBreaks++
      } else {
        result = await executeTool(tc.function.name, args)
      }

      tracker.toolCalls++
      tracker.toolsUsed[tc.function.name] = (tracker.toolsUsed[tc.function.name] || 0) + 1
      recentToolCalls.push(callSignature)
      toolResults.push({ toolCallId: tc.id, name: tc.function.name, result })
    }

    thinkingMsg.toolResults = toolResults

    const hasRealToolWork = toolResults.some(tr =>
      tr.name !== 'update_working_memory' && !tr.result.startsWith('[SYSTEM INTERCEPT]')
    )
    const newIdleSteps = hasRealToolWork ? 0 : idleSteps + 1

    return {
      message: thinkingMsg,
      shouldContinue: { continue: newIdleSteps < IDLE_STEP_THRESHOLD, idleSteps: newIdleSteps }
    }
  }

  return {
    isLoading,
    isStreaming,
    streamingText,
    streamingConvId,
    agentSteps,
    stopAgent,
    sendMessage,
  }
}
