import { useState, useRef, useCallback, useEffect } from 'react'
import type { Message, ToolResult, Conversation, AppSettings } from '../types'
import { TOOLS, IDLE_STEP_THRESHOLD } from '../constants/tools'
import { applySubagentModels } from '../utils/researchWorker'
import type { BackgroundSubagentRegistry, BgEntry } from '../utils/backgroundSubagents'
import { inferScoutFocus, type ScoutController, type RunScout } from '../utils/scout'
import type { SubagentActivityStore } from '../utils/subagentActivity'
import { AGENT_SYSTEM_PROMPT, PLANNING_MODE_PROMPT, LANGUAGE_RULE, LANGUAGE_PRIMING, LANGUAGE_REMINDER } from '../constants/prompts'
import { partitionTools, renderDeferredManifest, decideDeferral } from '../services/toolDeferral'
import { generateId, isSmallModel } from '../utils/formatting'
import { sanitizeReasoningLeaksSafe, StreamingSanitizer, emptyReplyNotice, extractThinking } from '../utils/sanitizers'
import { classifyProviderError, humanizeProviderError, isColdStartTimeout } from '../utils/providerErrors'
import { initStallState, decideStallRetry } from '../utils/stallRecovery'
import { renderSkillManifest, renderPinnedSkills, matchSkillsByText } from '../utils/skills'
import type { Skill } from '../types/skill'
import { resolveTurnUsage } from '../utils/usage'
import { countRecentRepeats, CIRCUIT_WINDOW, computeAgentProgress } from '../utils/circuitBreaker'
import { applyPlanToolCalls, planIsIncomplete, type LocalTask } from '../utils/planTracker'
import { resolveAdaptiveEffort } from '../utils/adaptiveEffort'
import { detectFreshness, buildDateLine, FRESHNESS_RULE, buildFreshnessNudge } from '../utils/freshness'
import { buildRagRouterHint, type RagStats } from '../utils/rag'
import { buildWorkflowRouterHint, type WorkflowSummary } from '../utils/workflows'
import { buildPersonaRouterHint, type PersonaLike } from '../utils/personas'
import { toolCallSummary } from '../utils/toolDisplay'
import { nextStreamPhase, classifyDelta, createPhaseProfiler, type StreamPhase } from '../utils/streamPhase'
import { runCompaction, mergeSummary, planEmergencyCompaction } from '../services/compaction'
import { renderWorkingMemory, renderPersistentMemory } from '../utils/memoryRender'
import { mergeFact, normalizeMemory } from '../utils/persistentMemory'
import { recallFreshFacts, renderFreshFactsBlock } from '../utils/freshFacts'
import { extractPreferenceCandidates, recordCandidates, selectPromotable, removeCandidates } from '../utils/preferenceLearning'
import { logInsight, beginInsightTurn, bumpInsightStep, endInsightTurn } from '../services/devInsights'
import { createContextEngine, getModelContextLimit, effectiveContextLimit, countToolSchemas, computeMessageBudget, AUTOCOMPACT_BUFFER_RATIO } from '../services/contextEngine'
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
  /** Registro de subagentes em background (v2.65.0) — o loop coleta os
   *  resultados prontos a cada passo e drena os pendentes antes de encerrar. */
  backgroundTasks?: BackgroundSubagentRegistry
  /** Atividade ao vivo dos subagentes (v2.66.0) — zerada a cada turno. */
  subagentActivity?: SubagentActivityStore
  /** Scout proativo (v2.69.0): controller dirigido pelo loop a cada passo. */
  scoutController?: ScoutController
  /** Primitiva que executa um scout sobre um tema (de useToolExecution). */
  runScout?: RunScout
  /** Há vaga ociosa no semáforo p/ o scout não competir com delegações. */
  canScout?: () => boolean
  speakText: (text: string) => void
  showToast: (message: string) => void
  onProviderSuccess?: () => void
  onProviderError?: (error: string) => void
  onUsage?: (inputTokens: number, outputTokens: number) => void
  /** Skills disponíveis — manifesto + pinned injetados no system prompt (v2.27.0). */
  skills?: Skill[]
  /** Tools extras (ex.: MCP) mescladas às TOOLS estáticas e enviadas ao modelo (v2.35.0). */
  extraTools?: any[]
  /** Matching semântico de skills (Fase 5, v2.56.0): dado o texto, devolve skills
   *  similares por significado (embeddings). Opt-in; ausente = só keyword. */
  semanticMatch?: (text: string) => Promise<Skill[]>
  /** Estatísticas da base RAG (contagem + fontes) — quando há índice, injeta a
   *  regra de roteamento do rag_search no system prompt (fusão do RAGPanel,
   *  v2.73.0). Ausente/zero = nenhuma menção (a IA não usa a tool à toa). */
  ragStats?: RagStats
  /** Workflows salvos (nome+descrição) — quando há algum, injeta a regra do
   *  run_workflow no system prompt (fusão do WorkflowBuilder, v2.76.0). */
  workflowList?: WorkflowSummary[]
  /** Personas disponíveis + a ativa — injeta a regra do set_persona no system
   *  prompt (fusão do PersonaEngine, v2.77.0). */
  personaList?: PersonaLike[]
  activePersonaName?: string | null
}

export function useChat({
  settings,
  providerConfig,
  activeConvId,
  conversationsRef,
  setConversations,
  isAgentMode,
  executeTool,
  backgroundTasks,
  subagentActivity,
  scoutController,
  runScout,
  canScout,
  speakText,
  showToast,
  onProviderSuccess,
  onProviderError,
  onUsage,
  skills,
  extraTools,
  semanticMatch,
  ragStats,
  workflowList,
  personaList,
  activePersonaName,
}: UseChatOptions) {
  // Use refs for callback props to avoid stale closures in useCallback
  const skillsRef = useRef(skills)
  skillsRef.current = skills
  const extraToolsRef = useRef(extraTools)
  extraToolsRef.current = extraTools
  const semanticMatchRef = useRef(semanticMatch)
  semanticMatchRef.current = semanticMatch
  const ragStatsRef = useRef(ragStats)
  ragStatsRef.current = ragStats
  const workflowListRef = useRef(workflowList)
  workflowListRef.current = workflowList
  const personaListRef = useRef(personaList)
  personaListRef.current = personaList
  const activePersonaNameRef = useRef(activePersonaName)
  activePersonaNameRef.current = activePersonaName
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
  // Fase invisível do stream (raciocínio / montagem de tool call) — ver
  // utils/streamPhase.ts. Alimenta o indicador de vida quando não há texto.
  const [streamingPhase, setStreamingPhase] = useState<StreamPhase>(null)
  // Tool currently executing (name + arg summary) — the live status the user
  // sees during long tool runs (execute_command can run up to 600s; before
  // this the UI showed only generic dots + "Passo N" the whole time).
  const [runningTool, setRunningTool] = useState<{ name: string; detail: string } | null>(null)

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
    backgroundTasks?.clear() // abandona subagentes em background pendentes
    scoutController?.clear() // aborta a pesquisa proativa em voo
    setIsLoading(false)
    setIsStreaming(false)
    setStreamingText(''); setStreamingPhase(null)
    setStreamingConvId(null)
    setRunningTool(null)
    if (streamCleanupRef.current) {
      streamCleanupRef.current()
      streamCleanupRef.current = null
    }
    window.electron.abortStream().catch((e: any) => console.warn('[useChat] abort error:', e))
    // Also tree-kill any execute_command in flight — abortStream only destroys
    // the LLM HTTP streams; without this a long build/backtest kept running
    // (up to 600s) after the user pressed Stop, the loop frozen on its await.
    window.electron.killCommands?.().catch((e: any) => console.warn('[useChat] kill commands error:', e))
    showToast('Agente interrompido pelo usuário.')
  }, [showToast, backgroundTasks, scoutController])

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
    backgroundTasks?.clear() // novo turno começa sem lotes de turnos anteriores
    subagentActivity?.clear() // painel de atividade zera a cada turno
    scoutController?.reset(!!settings.scoutEnabled) // scout proativo (opt-in; roda em qualquer turno com tema — não exige "modo agente")

    // ─── Aprendizado de preferências (Fase 2, v2.53.0) ───────────────
    // Captura preferências EXPLÍCITAS desta mensagem e, após reforço (≥2
    // conversas), promove ao bucket 'preferences' (injetado todo turno via
    // renderPersistentMemory). Local, fire-and-forget, fora do caminho quente.
    if (settings.memoryEnabled) {
      const candKey = 'openclaude-pref-candidates'
      void (async () => {
        try {
          const cands = extractPreferenceCandidates(inputText)
          if (cands.length === 0) return
          let store: any = {}
          try { store = JSON.parse(localStorage.getItem(candKey) || '{}') } catch { store = {} }
          store = recordCandidates(store, cands, convId, Date.now())
          const promotable = selectPromotable(store)
          if (promotable.length > 0) {
            let mem = await window.electron.loadMemory()
            const learned: string[] = []
            for (const p of promotable) {
              const r = mergeFact(mem, 'preference', p)
              mem = r.memory
              if (r.added) learned.push(p)
            }
            if (learned.length > 0) {
              await window.electron.saveMemory(mem)
              const lng = settings.language === 'en' ? 'en' : 'pt'
              showToast(lng === 'en'
                ? `Learned a preference: "${learned[0].slice(0, 60)}"`
                : `Preferência aprendida: "${learned[0].slice(0, 60)}"`)
            }
            store = removeCandidates(store, promotable)
          }
          localStorage.setItem(candKey, JSON.stringify(store))
        } catch { /* aprendizado é best-effort */ }
      })()
    }

    const { provider: finalProvider, model: finalModel, apiKey: finalApiKey, isNotOllama, modalHostname, customBaseUrl } = providerConfig

    // Correlação Dev Insights: daqui até o endInsightTurn() no finally, todo
    // logInsight ganha turn/step/v automaticamente. O desfecho vai no meta
    // do 'chat/complete'; turno sem complete = zumbi no digest.
    beginInsightTurn()
    let turnOutcome: 'ok' | 'error' | 'aborted' = 'ok'

    // Checkpoint/rewind (v2.37.0): marca o estado dos arquivos no início do
    // turno. Se o turno alterar arquivos, o finally oferece "Reverter" — como o
    // rewind do Claude Code. Marca é só ler o seq atual (sem custo).
    let checkpointSeq: number | null = null
    try { checkpointSeq = (await window.electron.checkpointMark?.())?.seq ?? null } catch { /* opcional */ }

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

      // Esforço de raciocínio efetivo deste turno. Precedência: override
      // por-conversa (EffortSlider, v2.51.0) > padrão global (Settings, v2.25.0).
      // No modo 'auto' (v2.50.0), a heurística local escala o esforço à
      // dificuldade da mensagem ANTES da IPC — main.js/reasoning-control.js só
      // veem níveis concretos.
      const chosenEffort = conv?.reasoningEffort ?? settings.reasoningEffort
      const effectiveEffort = chosenEffort === 'auto'
        ? resolveAdaptiveEffort({ text: inputText, isAgentMode, model: finalModel })
        : chosenEffort

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

      // Consciência de data + frescor de conhecimento (v2.61.0): o modelo
      // precisa saber a data de hoje e que sua memória PODE estar velha — senão
      // confia nela sem buscar (ver utils/freshness.ts). Sempre injetado (chat
      // e agente). E, se a mensagem do usuário é sensível a tempo, um detector
      // LOCAL (zero chamada de LLM, molde do adaptiveEffort) empurra a
      // verificação na web NESTE turno — porque não dá p/ confiar no modelo
      // desatualizado p/ decidir sozinho "quando buscar".
      systemPrompt += `\n\n${buildDateLine(lang, new Date())}\n${FRESHNESS_RULE[lang]}`
      const freshness = detectFreshness(String(inputText || ''), new Date().getFullYear())
      if (freshness.timeSensitive) {
        systemPrompt += `\n\n${buildFreshnessNudge(lang, freshness.signals)}`
      }

      // Skills (v2.27.0): manifesto barato (nome+desc → o modelo chama
      // load_skill sob demanda) + instruções completas das fixadas/casadas por
      // palavra-chave (injetadas direto, fallback p/ modelos que não chamam a
      // tool). Progressive disclosure, espelha o tool-deferral.
      {
        const allSkills = skillsRef.current || []
        const manifest = renderSkillManifest(allSkills)
        if (manifest) systemPrompt += `\n\n${manifest}`
        let autoMatched = matchSkillsByText(allSkills, String(inputText || ''))
        // Matching semântico (Fase 5, opt-in): adiciona skills similares por
        // significado que o keyword não pegou (ex.: "servidor de Tibia
        // alternativo" → skill de otserv). Best-effort; falha silenciosa.
        if (semanticMatchRef.current) {
          try {
            const sem = await semanticMatchRef.current(String(inputText || ''))
            if (sem.length) {
              const ids = new Set(autoMatched.map(s => s.id))
              autoMatched = [...autoMatched, ...sem.filter(s => !ids.has(s.id))]
            }
          } catch { /* fallback: keyword apenas */ }
        }
        const pinnedBlock = renderPinnedSkills(allSkills)
        const autoBlock = autoMatched.map(s => `[SKILL ATIVA: ${s.name}]\n${s.instructions}`).join('\n\n')
        const full = [pinnedBlock, autoBlock].filter(Boolean).join('\n\n')
        if (full) systemPrompt += `\n\n${full}`
      }

      // RAG (fusão do RAGPanel, v2.73.0): quando há índice local, injeta a regra
      // de quando acionar a ferramenta rag_search (responder a partir dos
      // documentos do usuário). Vazio quando não há índice → a IA não a usa à
      // toa. Mesmo padrão do manifesto de skills. Ver utils/rag.ts.
      const ragHint = buildRagRouterHint(ragStatsRef.current, lang)
      if (ragHint) systemPrompt += `\n\n${ragHint}`

      // Workflows salvos (fusão do WorkflowBuilder, v2.76.0): lista o que a IA
      // pode rodar via run_workflow; vazio quando não há nenhum. Ver utils/workflows.ts.
      const wfHint = buildWorkflowRouterHint(workflowListRef.current, lang)
      if (wfHint) systemPrompt += `\n\n${wfHint}`

      // Personas (fusão do PersonaEngine, v2.77.0): regra do set_persona +
      // personas disponíveis + a ativa. Ver utils/personas.ts.
      const personaHint = buildPersonaRouterHint(personaListRef.current, activePersonaNameRef.current, lang)
      if (personaHint) systemPrompt += `\n\n${personaHint}`

      // Tool deferral (v2.12.6; auto-decided since v2.12.11): move
      // rarely-used tools out of the request schema list into a compact
      // name/desc manifest in the system prompt; the model calls
      // `tool_search` to pull full schemas on demand. The decision is per
      // turn and per model — see decideDeferral (context-pressure heuristic).
      // MCP (v2.35.0): mescla as tools dos servidores MCP às TOOLS estáticas
      // antes de decidir deferral/particionar. Assim o modelo realmente recebe
      // as tools dos servidores configurados.
      // v2.64.0: quando os subagentes rodam no Ollama com uma LISTA de modelos,
      // injeta os nomes na descrição do delegate_subtasks p/ o orquestrador
      // escolher o modelo por subtarefa.
      const baseTools: any[] = (settings.subagentExecutor ?? 'ollama') !== 'modal' && settings.subagentModels?.length
        ? applySubagentModels(TOOLS as any, settings.subagentModels)
        : (TOOLS as any)
      const allTools: any[] = extraToolsRef.current?.length ? [...baseTools, ...extraToolsRef.current] : baseTools
      const deferral = decideDeferral(
        settings.toolDeferralMode,
        effectiveContextLimit(finalProvider, finalModel, settings.ollamaNumCtx),
        countToolSchemas(allTools),
      )
      const deferralEnabled = deferral.enabled
      const toolPartition = partitionTools(allTools, deferralEnabled)
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
      // Limite EFETIVO: nuvem = janela do modelo; Ollama = num_ctx real
      // (a janela teórica é inviável em GPU de consumidor — ver contextEngine).
      const modelLimit = effectiveContextLimit(finalProvider, finalModel, settings.ollamaNumCtx)
      let contextSummary = conv?.contextSummary || ''
      // Load persistent memory BEFORE the budget so its tokens are real
      // overhead, not hope that BUDGET_SAFETY_SLACK covers it (a grown facts
      // list easily exceeds the 256-token slack).
      let persistentMemoryText = ''
      let freshFactsText = ''
      if (settings.memoryEnabled) {
        try {
          const mem = await window.electron.loadMemory()
          persistentMemoryText = renderPersistentMemory(mem)
          // Camada 3 (v2.62.0): recupera fatos frescos verificados RELEVANTES a
          // esta mensagem e injeta como "reuse, não re-busque" (ou "re-verifique"
          // se o TTL venceu). Assim o agente fica atual E rápido. Ver freshFacts.ts.
          const nowFf = new Date()
          const recall = recallFreshFacts(normalizeMemory(mem).fresh, String(inputText || ''), nowFf)
          freshFactsText = renderFreshFactsBlock(recall.fresh, recall.stale, lang, nowFf)
        } catch (e) { console.warn('[useChat] memory load error:', e) }
      }
      const workingMemoryText = renderWorkingMemory(conv?.workingMemory)
      const tokenBudget = computeMessageBudget(modelLimit, {
        systemTokens: contextEngine.countTokens(systemPrompt),
        // Schemas actually sent this turn: the eager subset (+ tool_search)
        // when deferral is on, otherwise the full tool set.
        toolTokens: deferralEnabled ? toolPartition.eagerTokens : countToolSchemas(allTools),
        // Everything injected as memory: running summary + persistent facts
        // + the agent's working-memory reminder (re-sent every step).
        memoryTokens: contextEngine.countTokens(contextSummary)
          + contextEngine.countTokens(persistentMemoryText)
          + contextEngine.countTokens(freshFactsText)
          + contextEngine.countTokens(workingMemoryText),
        // Reserve the reply allocation so the prompt+completion never exceed
        // the window. Floor at 2k for providers that ignore max_tokens.
        responseReserve: settings.maxTokens || 2048,
        // Reserva o buffer de autocompact (~15%) — assim a história é compactada
        // PROATIVAMENTE a ~85% (como o painel já mostra e o Claude faz) em vez de
        // encher até 100% e tomar HTTP 400. A margem também absorve a imprecisão
        // do tokenizer em modelos não-OpenAI (GLM etc.). (v2.49.0)
        bufferReserve: Math.floor(modelLimit * AUTOCOMPACT_BUFFER_RATIO),
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
        logInsight('context', 'compaction', { dropped: droppedCount })

        // Route through the user's REAL provider (the old compactContext IPC
        // is Ollama-only and silently skipped cloud providers — see
        // services/compaction.ts). runCompaction never throws.
        const compactResult = await runCompaction(providerConfig, oldMessages, lang)
        if (compactResult.summary) {
          contextSummary = mergeSummary(contextSummary, compactResult.summary, undefined, lang)
          setConversations(prev => prev.map(c =>
            c.id !== convId ? c : { ...c, contextSummary }
          ))
        } else if (compactResult.error) {
          console.warn('[useChat] context compaction failed, using truncation:', compactResult.error)
        }
      }

      // Inject memory context (persistent memory was already loaded above,
      // pre-budget, via renderPersistentMemory — single source with the panel)
      const memoryContext: string[] = []
      if (contextSummary) {
        memoryContext.push(`[CONTEXT SUMMARY — earlier conversation]\n${contextSummary}`)
      }
      if (persistentMemoryText) {
        memoryContext.push(persistentMemoryText)
      }
      if (freshFactsText) {
        memoryContext.push(freshFactsText)
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
      const scoutBaseLen = allMessages.length // p/ inferir a atividade SÓ deste turno (não do histórico)
      // Fixed prefix length (system + memory + priming) — used by the
      // emergency context-compaction below, which only ever rewrites the
      // message region AFTER this prefix.
      const basePrefixLen = systemMessages.length + memoryMessages.length + primingMessages.length
      const cloudStreamingSupported = ['openai', 'openrouter', 'modal', 'anthropic'].includes(finalProvider)
      const useStreaming = isNotOllama ? (cloudStreamingSupported && settings.streamingEnabled) : settings.streamingEnabled
      let steps = 0
      let idleSteps = 0
      const recentToolCalls: string[] = []
      let activeMemory = conv?.workingMemory || null
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
      // Espelho local do plano deste turno (estilo monitor do Claude SDK): começa
      // do plano persistido e é atualizado pelas tool calls plan_tasks /
      // update_task_status conforme acontecem. Serve para detectar, no fim do
      // turno, se o modelo encerrou com tarefas pendentes (o bug: entregou o
      // relatório com o plano em 0/7).
      let localPlanTasks: LocalTask[] = Array.isArray(conv?.taskPlan?.tasks)
        ? conv!.taskPlan!.tasks.map(t => ({ id: t.id, status: t.status }))
        : []
      const trackPlanFromToolCalls = (calls: any[]) => { localPlanTasks = applyPlanToolCalls(localPlanTasks, calls) }
      // Quando o modelo dá a resposta final com o plano incompleto, injetamos um
      // nudge "conclua o plano" e seguimos o loop — capado para não loopar.
      let nudgeFinishPlan = false
      let planFinishNudges = 0
      const PLAN_FINISH_NUDGE_CAP = 3
      const keepGoingToFinishPlan = () => {
        if (!isAgentMode || stopRequestedRef.current) return false
        if (planIsIncomplete(localPlanTasks) && planFinishNudges < PLAN_FINISH_NUDGE_CAP) {
          planFinishNudges++
          nudgeFinishPlan = true
          return true
        }
        return false
      }
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
      // Auto-recuperação de stream travado (stall). Refaz o passo do zero —
      // seguro pois o parcial nunca é commitado no erro. 1 retry/passo, teto
      // por turno (ver utils/stallRecovery.ts). Este estado é o ÚNICO guard de
      // término do stall; NÃO resetar por passo (removeria o limite por-turno).
      let stallState = initStallState()
      // Auto-retry de timeout de cold-start (v2.26.0). O timeout nº1 da
      // telemetria é cold-start do GLM no Modal: a 1ª tentativa aquece o
      // container, a 2ª responde. 1 retry basta (e timeout != provider morto —
      // morto dá ECONNREFUSED/network, não timeout). Só quando nada foi
      // transmitido (senão duplicaria).
      let timeoutRetriesUsed = 0
      const MAX_TIMEOUT_RETRIES = 1
      // Erro não classificado (unknown) ANTES de qualquer conteúdo: é falha
      // pré-resposta (nada commitado nem cobrado) → 1 retry seguro. Recupera a
      // 2ª categoria de erro mais comum da telemetria, hoje sem retry (v2.36.0).
      let unknownRetriesUsed = 0
      const MAX_UNKNOWN_RETRIES = 1
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

      // Emergency context compaction: if the provider reports a context
      // overflow MID-TURN (a long agent run can outgrow the window — the
      // initial compaction only ran once, before the loop), summarize the
      // turn's oldest messages into the running summary and retry ONCE,
      // instead of throwing and discarding the whole turn (every tool call
      // already executed). Best-effort: on any failure we fall through to the
      // original throw, so worst case equals today's behavior.
      let contextCompactionsUsed = 0
      const MAX_CONTEXT_COMPACTIONS = 1
      const emergencyContextCompact = async (): Promise<boolean> => {
        if (contextCompactionsUsed >= MAX_CONTEXT_COMPACTIONS) return false
        const plan = planEmergencyCompaction(allMessages.length, basePrefixLen)
        if (!plan) return false
        const region = allMessages.slice(plan.regionStart, plan.regionEnd)
        let summary = ''
        try {
          const r = await runCompaction(
            { provider: finalProvider, model: finalModel, apiKey: finalApiKey, isNotOllama, modalHostname, customBaseUrl },
            region as any, lang,
          )
          summary = r.summary || ''
        } catch { return false }
        if (!summary) return false
        contextCompactionsUsed++
        contextSummary = mergeSummary(contextSummary, summary, undefined, lang)
        setConversations(prev => prev.map(c => c.id !== convId ? c : { ...c, contextSummary }))
        const memContent = [
          contextSummary ? `[CONTEXT SUMMARY — earlier conversation]\n${contextSummary}` : '',
          persistentMemoryText,
        ].filter(Boolean).join('\n\n')
        allMessages = [
          ...systemMessages,
          ...(memContent ? [{ role: 'system', content: memContent }] : []),
          ...primingMessages,
          ...allMessages.slice(plan.tailStart),
        ]
        logInsight('context', 'compaction', { emergency: true })
        return true
      }

      console.log('[useChat] Starting chat loop:', { provider: finalProvider, model: finalModel, useStreaming, messageCount: allMessages.length })
      logInsight('chat', 'turn', { provider: finalProvider, model: finalModel, agent: isAgentMode, streaming: useStreaming, effortMode: chosenEffort, effortResolved: effectiveEffort })

      // Duração da execução de tool do passo ANTERIOR — carregada para o
      // stream_profile do passo atual. Se a espera de 1º token cresce após
      // execuções longas, o container Modal desligou DURANTE a execução local
      // (cold-start client-fixable via keep-warm); se não, é idle puro do
      // provider (server-side). v2.21.0: torna essa bifurcação determinável.
      let prevStepToolMs = 0

      // Sem teto numérico de passos (uncap, v2.60.0). O loop termina por:
      // conclusão da tarefa (modelo para de chamar tools → continueLoop=false),
      // botão Parar (stopRequestedRef), circuit-breaker (chamadas repetidas) e
      // guard de ociosidade (IDLE_STEP_THRESHOLD). `steps` segue contando para
      // telemetria/nudges, mas não limita mais o loop. NÃO reintroduza um cap
      // numérico sem alinhar — foi uma decisão deliberada do usuário.
      // Injeta resultados de subagentes em background como contexto (v2.65.0).
      const injectBg = (entries: BgEntry[]) => {
        for (const e of entries) {
          allMessages.push({
            role: 'system',
            content: (lang === 'en'
              ? `[BACKGROUND SUBAGENT RESULT — batch ${e.id}]\n`
              : `[RESULTADO DO SUBAGENTE EM BACKGROUND — lote ${e.id}]\n`) + (e.result || ''),
          })
        }
      }

      while (continueLoop) {
        if (stopRequestedRef.current) break
        // Subagentes em background que já terminaram entram no contexto deste
        // passo, então o modelo pode usá-los enquanto segue trabalhando.
        if (backgroundTasks) injectBg(backgroundTasks.takeCompleted())

        // Scout proativo (v2.69.0): injeta o achado pronto (dados de hoje +
        // caminhos alternativos) e re-orienta a pesquisa pelo que a IA está
        // fazendo AGORA — infere o foco do objetivo do turno + a última ação.
        if (scoutController?.enabled && runScout) {
          const sr = scoutController.takeResult()
          if (sr) {
            allMessages.push({
              role: 'system',
              content: (lang === 'en'
                ? `[PROACTIVE RESEARCH — current info (today) / alternative paths for: ${sr.topic}]\n`
                : `[PESQUISA PROATIVA — info de hoje / caminhos alternativos para: ${sr.topic}]\n`) + sr.text,
            })
          }
          // Atividade SÓ deste turno (a partir de scoutBaseLen) → não confunde
          // com a resposta de um turno anterior do histórico.
          let activity = ''
          for (let i = allMessages.length - 1; i >= scoutBaseLen; i--) {
            const m = allMessages[i]
            if (m.role !== 'assistant') continue
            activity = String(m.content || '').slice(0, 160)
            if (!activity && Array.isArray(m.tool_calls) && m.tool_calls[0]) {
              const tc = m.tool_calls[0]
              try { activity = toolCallSummary(tc.function?.name, JSON.parse(tc.function?.arguments || '{}')) } catch { activity = tc.function?.name || '' }
            }
            break
          }
          scoutController.step(inferScoutFocus(String(inputText || ''), activity), runScout, canScout || (() => true))
        }
        steps++
        bumpInsightStep()
        sessionTracker.agentSteps = steps
        setAgentSteps(steps)
        const stepStartTime = Date.now()

        const requestMessages = [...allMessages]
        if (activeMemory && isAgentMode) {
          requestMessages.push({ role: 'system', content: renderWorkingMemory(activeMemory) })
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

        // Nudge de fim de turno: o modelo entregou resposta mas o plano ficou
        // incompleto. Mandamos concluir/atualizar antes de encerrar.
        if (nudgeFinishPlan) {
          requestMessages.push({
            role: 'system',
            content: lang === 'en'
              ? '[FINISH THE PLAN] You produced an answer but the task plan still has unfinished steps. Either keep executing the remaining steps by calling tools NOW, or — if a step is genuinely done — call update_task_status to mark it done (or failed, with a brief reason) before concluding. Do NOT end with steps left pending/in_progress.'
              : '[CONCLUA O PLANO] Você deu uma resposta, mas o plano de tarefas ainda tem passos não finalizados. Continue executando os passos restantes chamando as ferramentas AGORA, ou — se um passo realmente terminou — chame update_task_status para marcá-lo como done (ou failed, com um motivo curto) antes de concluir. NÃO encerre com passos pendentes/em andamento.',
          })
          nudgeFinishPlan = false
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
          // Fase invisível (raciocínio/tool args) — acumulada em variável local
          // e empurrada para o estado com throttle: deltas chegam dezenas de
          // vezes por segundo e cada setState re-renderiza o App inteiro.
          let phase: StreamPhase = null
          let lastPhasePush = 0
          // Perfil de tempo por fase (Dev Insights): espera/raciocínio/tool/texto.
          const phaseProfiler = createPhaseProfiler(Date.now())
          const pushPhase = (next: StreamPhase, force: boolean) => {
            phase = next
            const now = Date.now()
            if (!force && now - lastPhasePush < 300) return
            lastPhasePush = now
            setStreamingPhase(next)
          }
          // Throttle do TEXTO transmitido (v2.46.0): antes, setStreamingText
          // disparava a CADA token → o App re-renderizava e a bolha re-parseava
          // o markdown inteiro do texto que cresce (custo quadrático em respostas
          // longas, jank de CPU). Agora limita a ~20 atualizações/s, com flush
          // de borda final. O ritmo de digitação continua suave.
          const STREAM_TEXT_THROTTLE_MS = 50
          let lastTextPush = 0
          let textTimer: ReturnType<typeof setTimeout> | null = null
          const flushText = () => { lastTextPush = Date.now(); textTimer = null; setStreamingText(displayText) }
          const pushText = () => {
            const elapsed = Date.now() - lastTextPush
            if (elapsed >= STREAM_TEXT_THROTTLE_MS) { if (textTimer) { clearTimeout(textTimer); textTimer = null } flushText() }
            else if (!textTimer) { textTimer = setTimeout(flushText, STREAM_TEXT_THROTTLE_MS - elapsed) }
          }
          const cancelTextThrottle = () => { if (textTimer) { clearTimeout(textTimer); textTimer = null } }
          setIsStreaming(true)
          setStreamingText(''); setStreamingPhase(null)
          setStreamingPhase(null)

          try {
          await new Promise<void>((resolve, reject) => {
            const cleanup = window.electron.onStreamChunk((chunk: any) => {
              // Handle done event — check for error inside done chunk
              if (chunk.done) {
                cleanup()
                streamCleanupRef.current = null
                cancelTextThrottle()
                if (chunk.error) {
                  reject(new Error(chunk.error))
                } else {
                  setStreamingText(displayText) // flush de borda: bolha mostra o texto completo no handoff
                  resolve()
                }
                return
              }
              if (chunk.error) { cleanup(); streamCleanupRef.current = null; cancelTextThrottle(); reject(new Error(chunk.error)); return }
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
                phaseProfiler.onDelta(classifyDelta(delta), Date.now())
                const nextPhase = nextStreamPhase(phase, delta)
                if (nextPhase !== undefined) {
                  // Força o push quando o TIPO muda (apareceu/sumiu/trocou) para
                  // o indicador não atrasar 300ms nessas transições.
                  pushPhase(nextPhase, (nextPhase?.kind) !== (phase?.kind))
                }
                if (delta.content) {
                  accumulated += delta.content
                  // Sanitize reasoning leaks in real-time
                  const safe = sanitizer.process(delta.content)
                  if (safe) { displayText += safe; pushText() }
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

            const toolsForRequest = toolsDisabledForThisTurn ? [] : (deferralEnabled ? [...toolPartition.eager, toolPartition.metaTool] as any[] : allTools)
            const streamCall = isNotOllama
              ? window.electron.providerChatStream({
                  provider: finalProvider, apiKey: finalApiKey, model: finalModel,
                  messages: requestMessages, tools: toolsForRequest,
                  temperature: settings.temperature, max_tokens: settings.maxTokens,
                  modalHostname, customBaseUrl,
                  reasoningEffort: effectiveEffort // esforço de raciocínio (v2.25.0; auto-resolvido v2.50.0)
                })
              : window.electron.ollamaChatStream({
                  model: finalModel, messages: requestMessages, tools: toolsForRequest,
                  temperature: settings.temperature, max_tokens: settings.maxTokens,
                  numCtx: modelLimit, // janela real do local (evita timeout por contexto gigante)
                  reasoningEffort: effectiveEffort
                })
            // O handler do main RESOLVE com {error} (não rejeita) em early-returns
            // que acontecem antes de qualquer chunk `done` (ex.: baseUrl custom
            // inválida, provider sem streaming). Sem este .then a promise acima
            // nunca assenta e a UI congela no cursor piscando.
            streamCall
              .then((res: any) => { if (res?.error) { cleanup(); streamCleanupRef.current = null; reject(new Error(res.error)) } })
              .catch((err: any) => { cleanup(); streamCleanupRef.current = null; reject(err) })
          })
          // Stream concluído: registra onde foi o tempo deste passo (espera /
          // raciocínio / montagem de tool / texto) — alimenta o digest.
          // prevToolMs = duração da execução de tool do passo anterior, para
          // correlacionar "execução local longa → espera longa" (cold-start).
          logInsight('chat', 'stream_profile', { ...phaseProfiler.finish(Date.now()), prevToolMs: prevStepToolMs })
          } catch (err: any) {
            cancelTextThrottle()  // não deixar um flush atrasado disparar após o erro
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
              setStreamingText(''); setStreamingPhase(null)
              showToast(lang === 'en'
                ? `"${finalModel}" doesn't support tool use — retrying without tools.`
                : `"${finalModel}" não suporta tool use — refazendo sem ferramentas.`)
              steps-- // don't count the failed attempt
              continue
            }
            const cls = classifyProviderError(err?.message)
            // Stream travado (stall): refaz o passo. Vem ANTES do transitório
            // (stall também é retryable, mas tem orçamento próprio e ignora o
            // guard !accumulated — o parcial de um stall é provadamente
            // descartável). O catch precede o processToolCalls, então um
            // tool-call com JSON truncado nunca é executado; accumulated/
            // toolCallsData são re-declarados zerados na próxima iteração.
            if (cls.kind === 'stall' && !stopRequestedRef.current) {
              const d = decideStallRetry(stallState, steps)
              stallState = d.state
              if (d.retry) {
                logInsight('chat', 'retry', { kind: 'stall', hadPartial: !!accumulated, partialLen: accumulated.length, attempt: stallState.perTurn })
                setIsStreaming(false)
                setStreamingText(''); setStreamingPhase(null)
                showToast(humanizeProviderError(err?.message, lang) + (lang === 'en' ? ' (retrying…)' : ' (tentando de novo…)'))
                await new Promise(r => setTimeout(r, 1200))
                steps-- // rewind: re-roda ESTE passo com a mesma entrada
                continue
              }
            }
            // Timeout de cold-start: a 1ª tentativa aqueceu o container; refaz
            // o passo. Só sem conteúdo transmitido (senão duplicaria). Atinge
            // 14/17 erros da telemetria (Modal/GLM), que hoje não têm retry.
            if (isColdStartTimeout(cls.kind, !!accumulated) && timeoutRetriesUsed < MAX_TIMEOUT_RETRIES && !stopRequestedRef.current) {
              timeoutRetriesUsed++
              logInsight('chat', 'retry', { kind: 'timeout', attempt: timeoutRetriesUsed })
              setIsStreaming(false)
              setStreamingText(''); setStreamingPhase(null)
              showToast(lang === 'en' ? 'Provider warming up — retrying…' : 'Provedor aquecendo — tentando de novo…')
              await new Promise(r => setTimeout(r, 1500))
              steps--
              continue
            }
            // Transient failure: back off and retry once. Guarded by
            // `!accumulated` so we never re-send after partial output already
            // streamed (no double output / double billing). `cls.kind !== 'stall'`
            // mantém os orçamentos separados (stall já foi tratado acima).
            if (cls.retryable && cls.kind !== 'stall' && transientRetriesUsed < MAX_TRANSIENT_RETRIES && !accumulated) {
              transientRetriesUsed++
              logInsight('chat', 'retry', { kind: cls.kind })
              setIsStreaming(false)
              setStreamingText(''); setStreamingPhase(null)
              showToast(humanizeProviderError(err?.message, lang) + (lang === 'en' ? ' (retrying…)' : ' (tentando de novo…)'))
              await new Promise(r => setTimeout(r, 1500))
              steps-- // don't count the failed attempt
              continue
            }
            // Context overflow mid-turn: compact and retry once before giving
            // up (only when nothing streamed yet, so no double output).
            if (cls.kind === 'context' && !accumulated && await emergencyContextCompact()) {
              setIsStreaming(false)
              setStreamingText(''); setStreamingPhase(null)
              showToast(lang === 'en' ? 'Context overflowed — compacted, retrying…' : 'Contexto estourou — compactado, tentando de novo…')
              steps--
              continue
            }
            // Erro não classificado (unknown) SEM conteúdo: falha pré-resposta,
            // seguro refazer 1×. Recupera a 2ª categoria de erro da telemetria.
            if (cls.kind === 'unknown' && !accumulated && unknownRetriesUsed < MAX_UNKNOWN_RETRIES && !stopRequestedRef.current) {
              unknownRetriesUsed++
              logInsight('chat', 'retry', { kind: 'unknown', attempt: unknownRetriesUsed })
              setIsStreaming(false)
              setStreamingText(''); setStreamingPhase(null)
              showToast(humanizeProviderError(err?.message, lang) + (lang === 'en' ? ' (retrying…)' : ' (tentando de novo…)'))
              await new Promise(r => setTimeout(r, 1500))
              steps--
              continue
            }
            throw err
          }

          setIsStreaming(false)
          setStreamingText(''); setStreamingPhase(null)

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
          // Capture the model's reasoning (if any) BEFORE sanitizing it out, so
          // the final message can show it as a collapsible thinking block.
          const turnThinking = extractThinking(accumulated).thinking
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
            // Delegação explícita assume o recurso: pausa o scout antes (libera
            // a vaga) e retoma depois (v2.69.0).
            const delegatingS = toolCallsData.some(tc => tc?.function?.name === 'delegate_subtasks')
            if (delegatingS) scoutController?.pause()
            const { message: thinkingMsg, shouldContinue } = await processToolCalls(
              convId, accumulated, toolCallsData.map(tc => ({
                id: tc.id,
                function: { name: tc.function.name, arguments: tc.function.arguments }
              })),
              recentToolCalls, activeMemory, idleSteps, sessionTracker
            )
            if (delegatingS) scoutController?.resume()
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
            // Mantém o espelho local do plano em dia (plan_tasks / update_task_status).
            trackPlanFromToolCalls(toolCallsData)
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
            let safeContent = accumulated
            if (accumulated.trim().length === 0) {
              logInsight('chat', 'empty_reply', { provider: finalProvider, model: finalModel })
              safeContent = emptyReplyNotice(lang)
            }
            const finalMsg: Message = {
              id: generateId(), role: 'assistant', content: safeContent,
              ...(turnThinking ? { thinking: turnThinking } : {}),
              timestamp: new Date()
            }
            setConversations(prev => prev.map(c =>
              c.id !== convId ? c : { ...c, messages: [...c.messages, finalMsg] }
            ))
            if (accumulated) speakText(accumulated)
            // Plano incompleto? Mantém o loop e injeta o nudge de conclusão (capado).
            if (keepGoingToFinishPlan()) {
              allMessages = [...allMessages, { role: 'assistant', content: safeContent }]
            } else {
              sessionTracker.agentCompleted = true
              continueLoop = false
            }
          }

          if (finishReason === 'stop' && !(toolCallsData.length > 0 && toolCallsData[0]?.function?.name) && !nudgeFinishPlan) {
            sessionTracker.agentCompleted = true
            continueLoop = false
          }

        } else {
          // ─── Non-streaming path ────────────────────────────
          const toolsForRequest = toolsDisabledForThisTurn ? [] : (deferralEnabled ? [...toolPartition.eager, toolPartition.metaTool] as any[] : allTools)
          let response: any
          if (isNotOllama) {
            response = await window.electron.providerChat({
              provider: finalProvider, apiKey: finalApiKey, model: finalModel,
              messages: requestMessages, tools: toolsForRequest,
              temperature: settings.temperature, max_tokens: settings.maxTokens,
              modalHostname, customBaseUrl,
              reasoningEffort: effectiveEffort // esforço de raciocínio (v2.25.0; auto-resolvido v2.50.0)
            })
          } else {
            response = await window.electron.ollamaChat({
              model: finalModel, messages: requestMessages, tools: toolsForRequest,
              temperature: settings.temperature, max_tokens: settings.maxTokens,
              numCtx: modelLimit, // janela real do local (evita timeout por contexto gigante)
              reasoningEffort: effectiveEffort
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
            const cls = classifyProviderError(response.error)
            // Timeout de cold-start (não-stream): a 1ª tentativa aqueceu o
            // container; refaz. (Não-stream é tudo-ou-nada → sem conteúdo parcial.)
            if (isColdStartTimeout(cls.kind, false) && timeoutRetriesUsed < MAX_TIMEOUT_RETRIES && !stopRequestedRef.current) {
              timeoutRetriesUsed++
              logInsight('chat', 'retry', { kind: 'timeout', attempt: timeoutRetriesUsed })
              showToast(lang === 'en' ? 'Provider warming up — retrying…' : 'Provedor aquecendo — tentando de novo…')
              await new Promise(r => setTimeout(r, 1500))
              steps--
              continue
            }
            // Transient failure auto-retry (mirrors the streaming path).
            if (cls.retryable && transientRetriesUsed < MAX_TRANSIENT_RETRIES) {
              transientRetriesUsed++
              logInsight('chat', 'retry', { kind: cls.kind })
              showToast(humanizeProviderError(response.error, lang) + (lang === 'en' ? ' (retrying…)' : ' (tentando de novo…)'))
              await new Promise(r => setTimeout(r, 1500))
              steps--
              continue
            }
            // Context overflow mid-turn: compact and retry once before aborting.
            if (cls.kind === 'context' && await emergencyContextCompact()) {
              showToast(lang === 'en' ? 'Context overflowed — compacted, retrying…' : 'Contexto estourou — compactado, tentando de novo…')
              steps--
              continue
            }
            // Erro não classificado (unknown): não-stream é tudo-ou-nada (sem
            // parcial), então é seguro refazer 1×. Mesma lógica do streaming.
            if (cls.kind === 'unknown' && unknownRetriesUsed < MAX_UNKNOWN_RETRIES && !stopRequestedRef.current) {
              unknownRetriesUsed++
              logInsight('chat', 'retry', { kind: 'unknown', attempt: unknownRetriesUsed })
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
          // Capture the model's reasoning before it's sanitized out, so the
          // non-streaming final message can show it (Extended Thinking).
          const turnThinking = extractThinking(assistantMsg.content || '').thinking
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

            const toolStartTime = Date.now()
            const delegatingNS = normalizedTCs.some((tc: any) => tc?.function?.name === 'delegate_subtasks')
            if (delegatingNS) scoutController?.pause()
            const { message: thinkingMsg, shouldContinue } = await processToolCalls(
              convId, assistantMsg.content || '', normalizedTCs,
              recentToolCalls, activeMemory, idleSteps, sessionTracker
            )
            if (delegatingNS) scoutController?.resume()
            // Tempo de execução local deste passo → vira o prevToolMs do próximo
            // stream_profile (mede o gap que pode esfriar o container Modal).
            prevStepToolMs = Date.now() - toolStartTime
            idleSteps = shouldContinue.idleSteps
            if (!shouldContinue.continue) continueLoop = false
            trackPlanFromToolCalls(toolCalls)

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
            let safeContent = assistantMsg.content
            if (raw.length === 0) {
              logInsight('chat', 'empty_reply', { provider: finalProvider, model: finalModel })
              safeContent = emptyReplyNotice(lang)
            }
            const finalMsg: Message = {
              id: generateId(), role: 'assistant',
              content: safeContent,
              ...(turnThinking ? { thinking: turnThinking } : {}),
              timestamp: new Date()
            }
            setConversations(prev => prev.map(c =>
              c.id !== convId ? c : { ...c, messages: [...c.messages, finalMsg] }
            ))
            if (assistantMsg.content) speakText(assistantMsg.content)
            // Plano incompleto? Mantém o loop e injeta o nudge de conclusão (capado).
            if (keepGoingToFinishPlan()) {
              allMessages = [...allMessages, { role: 'assistant', content: safeContent || '' }]
            } else {
              sessionTracker.agentCompleted = true
              continueLoop = false
            }
          }

          if (choice.finish_reason === 'stop' && !(toolCalls && toolCalls.length > 0) && !nudgeFinishPlan) {
            sessionTracker.agentCompleted = true
            continueLoop = false
          }
        }

        sessionTracker.responseTimes.push(Date.now() - stepStartTime)

        // Drenar no fim (v2.65.0): se o turno vai encerrar mas ainda há
        // subagentes em background pendentes, espera os atrasados, injeta os
        // resultados e força mais um passo — a resposta final reflete o
        // trabalho deles em vez de descartá-lo.
        if (!continueLoop && !stopRequestedRef.current && backgroundTasks?.hasAny()) {
          setRunningTool({
            name: lang === 'en' ? 'background subagents' : 'subagentes em background',
            detail: lang === 'en' ? 'waiting for results…' : 'aguardando resultados…',
          })
          injectBg(await backgroundTasks.drain())
          setRunningTool(null)
          continueLoop = true
        }
      }
    } catch (e: any) {
      console.error('[useChat] Error in sendMessage:', e)
      turnOutcome = 'error'
      sessionTracker.errors++
      onProviderErrorRef.current?.(e.message || 'Unknown error')
      try { logInsight('error', classifyProviderError(e.message).kind, { provider: finalProvider, model: finalModel }) } catch { /* telemetry best-effort */ }
      setIsStreaming(false)
      setStreamingText(''); setStreamingPhase(null)
      const errMsg: Message = {
        id: generateId(), role: 'assistant',
        content: humanizeProviderError(e.message, settings.language || 'pt'), timestamp: new Date()
      }
      setConversations(prev => prev.map(c =>
        c.id !== convId ? c : { ...c, messages: [...c.messages, errMsg] }
      ))
    } finally {
      sendingRef.current = false
      scoutController?.clear() // fim do turno: aborta qualquer pesquisa proativa em voo
      setIsLoading(false)
      setIsStreaming(false)
      setStreamingText(''); setStreamingPhase(null)
      setStreamingConvId(null)
      setRunningTool(null)
      // Per-STEP response latency, decoupled from total agent-run length: a
      // multi-step browsing session runs for minutes and would otherwise
      // masquerade as "latency" in the digest (observed: 385s avg). Reused for
      // both telemetry and the analytics session record below.
      const avgRT = sessionTracker.responseTimes.length > 0
        ? Math.round(sessionTracker.responseTimes.reduce((a, b) => a + b, 0) / sessionTracker.responseTimes.length)
        : 0
      // Desfecho do turno: 'aborted' (Stop do usuário) vence 'error' — o abort
      // derruba o stream e o erro resultante é consequência, não causa.
      if (stopRequestedRef.current) turnOutcome = 'aborted'
      logInsight('chat', 'complete', { ms: avgRT, totalMs: Date.now() - sessionTracker.startTime, steps: sessionTracker.agentSteps, outcome: turnOutcome })
      endInsightTurn()

      // Checkpoint/rewind: se o turno alterou arquivos, oferece reverter tudo
      // de uma vez (restaura modificados e apaga os criados neste turno).
      if (checkpointSeq != null) {
        try {
          const seq = checkpointSeq
          const { count } = await window.electron.checkpointCount(seq)
          if (count > 0) {
            const lng = settings.language === 'en' ? 'en' : 'pt'
            showToast({
              message: lng === 'en' ? `${count} file(s) changed this turn` : `${count} arquivo(s) alterado(s) neste turno`,
              severity: 'info',
              duration: 15000,
              action: {
                label: lng === 'en' ? 'Revert' : 'Reverter',
                onClick: async () => {
                  const r = await window.electron.checkpointRestore(seq)
                  showToast(r.errors?.length
                    ? (lng === 'en' ? `Reverted ${r.count}, ${r.errors.length} error(s)` : `Revertido ${r.count}, ${r.errors.length} erro(s)`)
                    : (lng === 'en' ? `Reverted ${r.count} file(s)` : `Revertido(s) ${r.count} arquivo(s)`))
                },
              },
            } as any)
          }
        } catch { /* checkpoint é best-effort */ }
      }

      // Save session analytics
      if (settings.analyticsEnabled !== false) {
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
  }, [isLoading, providerConfig, settings, isAgentMode, conversationsRef, setConversations, executeTool, backgroundTasks, subagentActivity, scoutController, runScout, canScout, speakText, showToast])

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
      // If the user pressed Stop mid-batch, don't dispatch the remaining tool
      // calls (which can be destructive — write_file/execute_command). Still
      // push a synthetic result for each so the tool_call_id ↔ tool_result
      // mapping the provider requires stays consistent.
      if (stopRequestedRef.current) {
        toolResults.push({ toolCallId: tc.id, name: tc.function.name, result: '[CANCELADO pelo usuário]' })
        continue
      }
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
      } else if (countRecentRepeats(recentToolCalls, callSignature) >= 2) {
        // Loop guard: the same exact call appeared ≥2× within the recent
        // window (not across the whole session — a tool legitimately reused
        // much later shouldn't trip it). This is the 3rd identical attempt.
        const repeats = countRecentRepeats(recentToolCalls, callSignature)
        result = `[SYSTEM INTERCEPT]: Circuit Breaker Triggered. You already called "${tc.function.name}" with these exact arguments ${repeats} times. This approach is not working. You MUST try a completely different strategy, use a different tool, or give a final text response. Do NOT repeat this call.`
        tracker.circuitBreaks++
        logInsight('agent', 'circuit_break', { tool: tc.function.name })
      } else {
        setRunningTool({ name: tc.function.name, detail: toolCallSummary(tc.function.name, args) })
        try {
          result = await executeTool(tc.function.name, args)
        } finally {
          setRunningTool(null)
        }
      }

      tracker.toolCalls++
      tracker.toolsUsed[tc.function.name] = (tracker.toolsUsed[tc.function.name] || 0) + 1
      recentToolCalls.push(callSignature)
      // Bound the signature history to the detection window so it can't grow
      // unbounded over a long agent session.
      if (recentToolCalls.length > CIRCUIT_WINDOW) {
        recentToolCalls.splice(0, recentToolCalls.length - CIRCUIT_WINDOW)
      }
      toolResults.push({ toolCallId: tc.id, name: tc.function.name, result })
    }

    thinkingMsg.toolResults = toolResults

    return {
      message: thinkingMsg,
      shouldContinue: computeAgentProgress(toolResults, idleSteps, IDLE_STEP_THRESHOLD),
    }
  }

  return {
    isLoading,
    isStreaming,
    streamingText,
    streamingConvId,
    streamingPhase,
    agentSteps,
    runningTool,
    stopAgent,
    sendMessage,
  }
}
