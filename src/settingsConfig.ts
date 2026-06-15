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
   *  ajustam profundidade onde o provider suporta (GLM/Ollama são on/off). */
  reasoningEffort: 'default' | 'off' | 'low' | 'medium' | 'high'
  memoryEnabled: boolean
  analyticsEnabled: boolean
  permissionLevel: PermissionLevel
  mcpServers: McpServer[]
  /** Hooks de ciclo de vida (v2.38.0) — comandos rodados após tools. */
  hooks?: HookDef[]
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
  notifyOnComplete: true,
  toolDeferralMode: 'auto',
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
