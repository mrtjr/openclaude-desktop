// ─── Settings config (boot-light) ──────────────────────────────────
//
// The settings TYPES, defaults, and load/save logic live here — apart from
// the heavy Settings *modal* component (lucide icons + provider panes). App
// needs loadSettings at boot, so keeping it out of Settings.tsx lets the
// modal itself load lazily (v2.12.20) instead of riding in the boot bundle.
// Settings.tsx re-exports everything below for backward compatibility.

export type Provider = 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal' | 'custom'
export type Language = 'pt' | 'en'
export type PermissionLevel = 'ask' | 'auto_edits' | 'planning' | 'ignore'
import type { PermissionRule } from './utils/permissionRules'
import type { DisplayTransform } from './utils/outputHooks'
import type { SandboxConfig } from './utils/commandSandbox'
import { DEFAULT_SANDBOX } from './utils/commandSandbox'

/** Esforço de raciocínio (v2.25.0; 'auto' em v2.50.0). Reusado pelo seletor
 *  global (Settings) e pelo override por-conversa (EffortSlider). */
export type ReasoningEffort = 'default' | 'auto' | 'off' | 'low' | 'medium' | 'high'

export interface McpServer {
  name: string
  command: string
}

/** Hook de ciclo de vida (v2.38.0) — roda um comando shell após uma tool
 *  executar com sucesso (ex.: lint/format/test após edit_file). matcher = nome
 *  exato da tool, '*' (todas) ou prefixo terminando em '*' (ex.: 'browser_*'). */
export interface HookDef {
  /** PreToolUse roda ANTES da tool (exit≠0 bloqueia); PostToolUse roda DEPOIS. */
  event: 'PostToolUse' | 'PreToolUse'
  matcher: string
  command: string
  /** v2.94.0 — só PostToolUse: 'append' (default) anexa a saída do hook ao
   *  resultado; 'replace' faz o stdout do hook SUBSTITUIR o resultado da tool
   *  (porta o updatedToolOutput do Claude Code — ex.: redigir segredos). */
  mode?: 'append' | 'replace'
}

export interface ModalKey {
  id: string
  key: string
  label?: string
  enabled: boolean
}

export interface AppSettings {
  autoStart: boolean
  temperature: number
  systemPrompt: string
  maxTokens: number
  streamingEnabled: boolean
  /** v2.12.34 — show the model's reasoning (Extended Thinking) in a collapsible
   *  block above the answer. Default on. */
  showThinking?: boolean
  language: Language
  provider: Provider
  openaiApiKey: string
  openaiModel: string
  geminiApiKey: string
  geminiModel: string
  anthropicApiKey: string
  anthropicModel: string
  openrouterApiKey: string
  openrouterModel: string
  modalApiKey: string
  modalApiKeys: ModalKey[]
  modalPoolFallbackOllama: boolean
  modalModel: string
  modalHostname: string
  // ── Custom OpenAI-compatible provider (Groq, Together, DeepInfra, Fireworks…)
  customApiKey: string
  customModel: string
  customBaseUrl: string
  customLabel: string
  contextLimit: number
  /** v2.24.0 — janela de contexto REAL para modelos locais do Ollama. A janela
   *  teórica (128k+) é inviável num GPU de consumidor; isto limita o que é
   *  enviado E vira o num_ctx do Ollama. Suba se sua VRAM/modelo aguentar. */
  ollamaNumCtx: number
  /** v2.25.0 — esforço de raciocínio. 'default' não envia nada (comportamento
   *  do provider). 'off' desliga o thinking (mais rápido); 'low/medium/high'
   *  ajustam profundidade onde o provider suporta (GLM/Ollama são on/off).
   *  v2.50.0 — 'auto': escala o esforço à dificuldade da mensagem por turno
   *  (heurística local, resolvida no cliente antes da IPC; ver adaptiveEffort). */
  reasoningEffort: ReasoningEffort
  memoryEnabled: boolean
  analyticsEnabled: boolean
  permissionLevel: PermissionLevel
  mcpServers: McpServer[]
  /** Hooks de ciclo de vida (v2.38.0) — comandos rodados após tools. */
  hooks?: HookDef[]
  /** Matching semântico de skills (Fase 5, v2.56.0) — usa embeddings do Ollama
   *  p/ casar skills por significado. Opt-in (default off; requer Ollama). */
  semanticSkillMatch?: boolean
  /** v2.12.0 — fire a native OS notification when a response completes
   *  while the window is not focused. Opt-out via Settings (default on). */
  notifyOnComplete?: boolean
  /** v2.12.3 — user-chosen display name shown in the sidebar profile
   *  row and UserMenu header. Local-only, no cloud identity. */
  profileName?: string
  /** Legacy boolean (v2.12.6). Superseded by `toolDeferralMode` in
   *  v2.12.11; kept only so loadSettings can migrate old installs. */
  toolDeferralEnabled?: boolean
  /** v2.12.11 — tool-schema deferral mode. 'auto' (default) decides per
   *  turn from model context pressure; 'on'/'off' force it. Deferred tools
   *  appear as name+description in the system prompt and load via
   *  `tool_search`. See decideDeferral() in services/toolDeferral.ts. */
  toolDeferralMode?: 'auto' | 'on' | 'off'
  /** v2.63.0 — onde rodam os subagentes do delegate_subtasks (agora COM
   *  ferramentas de leitura). 'ollama' (padrão): enxame local paralelo +
   *  grátis (split orquestrador-worker — o modelo forte planeja, workers
   *  locais pesquisam). 'modal': usa o pool de keys do Modal. Ver
   *  researchWorker.ts. */
  subagentExecutor?: 'ollama' | 'modal'
  /** v2.63.0 — modelo Ollama padrão dos workers de pesquisa (fallback quando
   *  `subagentModels` está vazio). Pequeno/rápido é o ideal. */
  subagentModel?: string
  /** v2.64.0 — LISTA de modelos Ollama que os subagentes podem usar. O
   *  orquestrador escolhe o melhor por subtarefa (campo "model" do
   *  delegate_subtasks); se não escolher, faz rodízio sobre esta lista. Vazio →
   *  usa `subagentModel`. Ver resolveSubagentModel/applySubagentModels. */
  subagentModels?: string[]
  /** v2.65.0 — força delegate_subtasks SEMPRE em background (a IA principal
   *  continua trabalhando enquanto os subagentes rodam; resultados injetados
   *  quando prontos, com drenagem no fim do turno). Off → o modelo decide via
   *  o parâmetro `background`. Ver backgroundSubagents.ts. */
  subagentsBackground?: boolean
  /** v2.66.0 — timeout POR PASSO de cada subagente Ollama, em segundos (rede de
   *  segurança contra um Ollama travado, NÃO um limite de trabalho). Default
   *  600s; 0 = sem limite (para tarefas longas, com o risco de congelar se o
   *  Ollama realmente travar). */
  subagentTimeoutSec?: number
  /** v2.67.0 — máximo de subagentes Ollama rodando AO MESMO TEMPO em todo o app
   *  (entre lotes/turnos). Evita engarrafar a máquina com muitos modelos locais
   *  carregados de uma vez. Default 2. A IA principal não delega mais enquanto o
   *  limite estiver ocupado (controle de admissão). Ver semaphore.ts. */
  subagentConcurrency?: number
  /** v2.88.0 — profundidade máxima da árvore de subagentes ANINHADOS. 1 = sem
   *  aninhamento (clássico: só os workers diretos do orquestrador). 2 = um
   *  worker pode abrir UM nível de sub-workers; teto 5 (igual ao Claude Code).
   *  Os filhos rodam sequencialmente dentro da vaga do pai (sem nova vaga do
   *  semáforo → sem deadlock, carga local ≤ subagentConcurrency). Default 2.
   *  Ver researchWorker.canDelegateAtDepth. */
  subagentMaxDepth?: number
  /** v2.90.0 — MODO SEGURO (porta --safe-mode do Claude Code): sobe a sessão SEM
   *  nenhuma customização (systemPrompt custom, hooks, servidores MCP, skills,
   *  persona, instruções de projeto) para depurar uma config quebrada — ex.: um
   *  hook PreToolUse barrando tudo, um MCP travado, um prompt ruim. Provider e
   *  modelo continuam (senão não dá pra conversar). Default off. */
  safeMode?: boolean
  /** v2.91.0 — CADEIA de modelos de fallback do chat principal (porta o
   *  fallbackModel do Claude Code). Ids de modelo do PROVEDOR ATIVO, tentados em
   *  ordem quando o modelo atual esgota os retries de um erro recuperável
   *  (overload/timeout/instabilidade). Vazio → sem fallback. Ver
   *  utils/fallbackChain.ts. */
  fallbackModels?: string[]
  /** v2.93.0 — regras de permissão por PARÂMETRO (porta o Tool(param:value) do
   *  Claude Code). Olham os argumentos da chamada: deny bloqueia, ask força
   *  confirmação, allow pula o gate de nível. Ver utils/permissionRules.ts. */
  permissionRules?: PermissionRule[]
  /** v2.94.0 — transformações de EXIBIÇÃO do texto do assistente (porta o
   *  MessageDisplay hook do Claude Code, client-side via regex): redigir/ocultar
   *  trechos antes de renderizar. Não muta o conteúdo salvo. Ver
   *  utils/outputHooks.applyDisplayTransforms. */
  displayTransforms?: DisplayTransform[]
  /** v2.97.0 — estilo de FORMATO da resposta (porta os output styles do Claude
   *  Code): 'default' | 'concise' | 'explanatory' | 'learning' | 'code'.
   *  Independente da persona (voz). Ver constants/outputStyles.ts. */
  outputStyle?: string
  /** v2.98.0 — itens da BARRA DE STATUS (porta a statusLine do Claude Code):
   *  subconjunto de model/provider/branch/cwd/persona/context. Vazio → mostra a
   *  dica de atalhos padrão. Ver utils/statusLine.ts. */
  statusLineItems?: string[]
  /** v2.101.0 — sandbox de POLÍTICA do execute_command (inspirado no sandboxed
   *  Bash do Claude Code): allowlist roda sem prompt, denylist é bloqueada.
   *  Não é isolamento de kernel. Ver utils/commandSandbox.ts. */
  commandSandbox?: SandboxConfig
  /** v2.103.0 — botão de ENTRADA por voz (push-to-talk) no composer. Só aparece
   *  se a Web Speech API existir. Default on. Ver hooks/useSpeechInput.ts. */
  voiceInputEnabled?: boolean
  /** v2.125.0 — taxa de GPU do Modal em $/segundo para ESTIMAR custo (Modal cobra
   *  GPU-segundo, não token). Default ~A100 ($0.000583/s). A fatura real está no
   *  console do Modal e varia pelo tipo de GPU. Ver constants/pricing.modalGpuCost. */
  modalGpuRatePerSec?: number
  /** v2.69.0 — SCOUT proativo (opt-in, default off): em turnos agênticos com
   *  subagentes ociosos, um worker pesquisa por conta própria dados ATUAIS (data
   *  de hoje) + caminhos alternativos sobre o que a IA principal está fazendo, e
   *  injeta no contexto dela. Pausa em delegações explícitas; reinicia quando o
   *  tema muda. Só roda em vaga ociosa do semáforo. Ver scout.ts. */
  scoutEnabled?: boolean
  /** v2.72.0 — headroom nativo: comprime a saída das ferramentas (remove
   *  redundância de logs/builds repetitivos) ANTES de ir ao modelo, economizando
   *  tokens. Conservador (só repetição óbvia). Default on. Ver
   *  outputCompression.ts. */
  compressToolOutputs?: boolean
  /** v2.133.0 — sugerir perguntas de acompanhamento (chips estilo Perplexity)
   *  ao fim das respostas do chat normal. O modelo emite até 3 follow-ups num
   *  trailer marcado que é parseado e removido do texto. Só no chat (não no
   *  modo agente). Default on. Ver followups.ts. */
  suggestFollowups?: boolean
  /** v2.73.0 — modelo de embedding usado pela ferramenta rag_search do chat
   *  (fusão do RAGPanel). DEVE ser o mesmo com que o índice foi gerado, senão os
   *  vetores ficam em espaços diferentes e o score é lixo. Ausente → o default
   *  do RAGPanel ('mxbai-embed-large', ver DEFAULT_RAG_EMBED_MODEL). */
  ragEmbeddingModel?: string
  /** v2.74.0 — modelo de VISÃO usado pelas ferramentas capture_screen/
   *  analyze_image quando o provider é Ollama (o modelo de chat local costuma
   *  ser só-texto). Ausente → 'llava' (ver DEFAULT_VISION_OLLAMA_MODEL). Na
   *  nuvem usa-se o modelo configurado do provider (gpt-4o/gemini/claude…). */
  visionModel?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  temperature: 0.7,
  systemPrompt: `Você é um assistente IA chamado OpenClaude.\n\nREGRAS OBRIGATÓRIAS:\n1. SEMPRE responda no mesmo idioma que o usuário usou. Se ele escrever em português, responda em português. Se escrever em inglês, responda em inglês.\n2. Seja direto e objetivo. Não use ferramentas desnecessariamente — só use quando o usuário pedir explicitamente uma ação no sistema.\n3. Quando o usuário disser \"ola\", \"olá\", \"oi\" ou saudações similares, apenas cumprimente de volta e pergunte como pode ajudar. NÃO liste arquivos nem execute comandos.\n4. Use ferramentas (execute_command, read_file, list_directory, etc.) SOMENTE quando o usuário pedir explicitamente.\n5. Respostas curtas para perguntas simples. Respostas detalhadas apenas quando necessário.\n6. Nunca recuse pedidos legítimos do usuário.`,
  maxTokens: 4096,
  streamingEnabled: true,
  showThinking: true,
  language: 'pt',
  provider: 'ollama',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-2.5-pro',
  modalApiKey: '',
  modalApiKeys: [],
  modalPoolFallbackOllama: false,
  modalModel: 'zai-org/GLM-5.1-FP8',
  modalHostname: 'api.us-west-2.modal.direct',
  customApiKey: '',
  customModel: '',
  customBaseUrl: '',
  customLabel: 'Custom (OpenAI-compatible)',
  contextLimit: 50,
  ollamaNumCtx: 8192,
  reasoningEffort: 'default',
  memoryEnabled: false,
  analyticsEnabled: true,
  permissionLevel: 'ask',
  mcpServers: [],
  hooks: [],
  semanticSkillMatch: false,
  notifyOnComplete: true,
  toolDeferralMode: 'auto',
  subagentExecutor: 'ollama',
  subagentModel: 'llama3.2',
  subagentModels: [],
  subagentsBackground: false,
  subagentTimeoutSec: 600,
  subagentConcurrency: 2,
  subagentMaxDepth: 2,
  safeMode: false,
  fallbackModels: [],
  permissionRules: [],
  displayTransforms: [],
  outputStyle: 'default',
  statusLineItems: [],
  commandSandbox: DEFAULT_SANDBOX,
  voiceInputEnabled: true,
  modalGpuRatePerSec: 0.000583,
  scoutEnabled: false,
  compressToolOutputs: true,
  suggestFollowups: true,
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('openclaude-settings')
    if (stored) {
      const merged: AppSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      // Migration: populate modalApiKeys array from legacy single modalApiKey
      if (merged.modalApiKey && (!merged.modalApiKeys || merged.modalApiKeys.length === 0)) {
        merged.modalApiKeys = [{
          id: 'migrated-' + Date.now(),
          key: merged.modalApiKey,
          label: 'Principal',
          enabled: true,
        }]
      }
      // Migration: pre-v2.11.5 installs defaulted modalModel to bogus Groq
      // names (llama-3.1-70b / llama-3.1-8b / mixtral-8x7b) that don't
      // exist on Modal Research — every request 404'd. Auto-upgrade to
      // the real default so existing users don't have to manually fix it
      // in Settings.
      const STALE_MODAL_MODELS = new Set([
        'llama-3.1-70b', 'llama-3.1-8b', 'mixtral-8x7b',
        'llama-3.1-405b', 'llama-3-70b',
      ])
      if (STALE_MODAL_MODELS.has(merged.modalModel)) {
        merged.modalModel = DEFAULT_SETTINGS.modalModel
      }
      // Migration (v2.12.11): legacy boolean → tri-state mode. 'auto' is the
      // new smart default; honour a legacy explicit opt-in as 'on'.
      if (merged.toolDeferralMode == null) {
        merged.toolDeferralMode = merged.toolDeferralEnabled === true ? 'on' : 'auto'
      }
      return merged
    }
  } catch (e) { console.warn('[settings] load error:', e) }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem('openclaude-settings', JSON.stringify(settings))
}
