import { useState, useRef, useCallback, useEffect } from 'react'
import type { Message, ToolResult, Conversation, AppSettings } from '../types'
import { TOOLS, AGENT_SAFETY_LIMIT, NORMAL_SAFETY_LIMIT, IDLE_STEP_THRESHOLD } from '../constants/tools'
import { AGENT_SYSTEM_PROMPT, PLANNING_MODE_PROMPT, LANGUAGE_RULE, LANGUAGE_PRIMING, LANGUAGE_REMINDER } from '../constants/prompts'
import { generateId, isSmallModel } from '../utils/formatting'
import { sanitizeReasoningLeaks, StreamingSanitizer } from '../utils/sanitizers'
import type { ProviderConfig } from './useProviderConfig'

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

  const sendMessage = useCallback(async (inputText: string) => {
    // Use ref for activeConvId to always have the latest value
    const convId = activeConvIdRef.current
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

    const { provider: finalProvider, model: finalModel, apiKey: finalApiKey, isNotOllama, modalHostname } = providerConfig

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
      }
      if (isAgentMode) {
        systemPrompt = AGENT_SYSTEM_PROMPT[lang] + (systemPrompt ? (lang === 'pt' ? "\n\nInstruções Adicionais:\n" : "\n\nAdditional Instructions:\n") + systemPrompt : "")
      }
      systemPrompt += LANGUAGE_RULE[lang]

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

      // Smart context management
      const MAX_CONTEXT_MESSAGES = settings.contextLimit || 50
      const COMPACT_THRESHOLD = Math.floor(MAX_CONTEXT_MESSAGES * 0.7)
      let contextSummary = conv?.contextSummary || ''
      let trimmedHistory = history

      if (history.length > MAX_CONTEXT_MESSAGES) {
        const overflow = history.length - COMPACT_THRESHOLD
        const oldMessages = history.slice(0, overflow)
        trimmedHistory = history.slice(overflow)

        try {
          const compactResult = await window.electron.compactContext({
            messages: oldMessages,
            model: finalModel,
            language: lang
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
          setIsStreaming(true)
          setStreamingText('')

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

            const streamCall = isNotOllama
              ? window.electron.providerChatStream({
                  provider: finalProvider, apiKey: finalApiKey, model: finalModel,
                  messages: requestMessages, tools: TOOLS,
                  temperature: settings.temperature, max_tokens: settings.maxTokens,
                  modalHostname
                })
              : window.electron.ollamaChatStream({
                  model: finalModel, messages: requestMessages, tools: TOOLS,
                  temperature: settings.temperature, max_tokens: settings.maxTokens
                })
            streamCall.catch((err: any) => { cleanup(); streamCleanupRef.current = null; reject(err) })
          })

          setIsStreaming(false)
          setStreamingText('')

          // Flush sanitizer and sanitize final accumulated text
          const remaining = sanitizer.flush()
          if (remaining) displayText += remaining
          accumulated = sanitizeReasoningLeaks(accumulated)
          console.log('[useChat] Stream completed:', { accumulatedLen: accumulated.length, toolCalls: toolCallsData.length, finishReason })
          onProviderSuccessRef.current?.()

          if (toolCallsData.length > 0 && toolCallsData[0]?.function?.name) {
            const { message: thinkingMsg, shouldContinue } = await processToolCalls(
              convId, accumulated, toolCallsData.map(tc => ({
                id: tc.id,
                function: { name: tc.function.name, arguments: tc.function.arguments }
              })),
              recentToolCalls, activeMemory, idleSteps, sessionTracker
            )
            if (thinkingMsg.toolResults?.some(tr => tr.name === 'update_working_memory')) {
              const wmResult = thinkingMsg.toolResults.find(tr => tr.name === 'update_working_memory')
              if (wmResult) {
                try { activeMemory = JSON.parse(wmResult.result.replace('[SYSTEM]: Working memory updated successfully.', '')) } catch (e) { console.warn('[useChat] working memory parse:', e) }
              }
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
            const finalMsg: Message = {
              id: generateId(), role: 'assistant', content: accumulated, timestamp: new Date()
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
          let response: any
          if (isNotOllama) {
            response = await window.electron.providerChat({
              provider: finalProvider, apiKey: finalApiKey, model: finalModel,
              messages: requestMessages, tools: TOOLS,
              temperature: settings.temperature, max_tokens: settings.maxTokens,
              modalHostname
            })
          } else {
            response = await window.electron.ollamaChat({
              model: finalModel, messages: requestMessages, tools: TOOLS,
              temperature: settings.temperature, max_tokens: settings.maxTokens
            })
          }

          if (response.error) throw new Error(response.error)
          onProviderSuccessRef.current?.()

          const choice = response.choices?.[0]
          if (!choice) break

          const assistantMsg = choice.message
          // Sanitize reasoning leaks from non-streaming response
          if (assistantMsg.content) {
            assistantMsg.content = sanitizeReasoningLeaks(assistantMsg.content)
          }
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
            const finalMsg: Message = {
              id: generateId(), role: 'assistant',
              content: assistantMsg.content || '', timestamp: new Date()
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
        content: `Erro: ${e.message}`, timestamp: new Date()
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

      // Report usage for cost tracking (rough estimate from message lengths)
      const usageFn = onUsageRef.current
      if (usageFn) {
        const conv = conversationsRef.current.find(c => c.id === convId)
        if (conv) {
          const inputChars = conv.messages.filter(m => m.role !== 'assistant').reduce((s, m) => s + m.content.length, 0)
          const outputChars = conv.messages.filter(m => m.role === 'assistant').slice(-sessionTracker.agentSteps || -1).reduce((s, m) => s + m.content.length, 0)
          usageFn(Math.ceil(inputChars / 4), Math.ceil(outputChars / 4))
        }
      }
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
