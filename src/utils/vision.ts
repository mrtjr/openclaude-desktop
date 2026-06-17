// ─── Visão no chat (fusão do VisionMode — v2.74.0) ──────────────────
//
// O VisionMode capturava a tela / analisava imagens num painel à parte, e o
// chat NÃO tinha entrada de visão alguma (o useImageAttachment era código
// morto). Aqui a capacidade vira DUAS ferramentas que a IA aciona sozinha:
//   - capture_screen: tira um screenshot do desktop e o analisa (a IA "vê" a
//     tela do usuário) — responde "o que tem na minha tela / esse erro / esse
//     gráfico".
//   - analyze_image: lê uma imagem em disco (por caminho) e a analisa.
// Ambas roteiam pelo IPC visionChat que já existe (Ollama llava / GPT-4o /
// Gemini / Claude / OpenRouter / Modal). O painel VisionMode segue vivo.
//
// Helpers PUROS/testáveis: a resolução de provider/modelo/chave de visão e a
// formatação do resultado. O IPC (captureScreen/visionChat/readDocument) é
// injetado pelo chamador (useToolExecution).

export const DEFAULT_VISION_OLLAMA_MODEL = 'llava'

/** Providers que o handler vision-chat sabe falar (custom fica de fora). */
const VISION_PROVIDERS = new Set(['ollama', 'openai', 'gemini', 'anthropic', 'openrouter', 'modal'])

export interface VisionSettingsLike {
  provider?: string
  visionModel?: string
  openaiModel?: string; geminiModel?: string; anthropicModel?: string
  openrouterModel?: string; modalModel?: string
  openaiApiKey?: string; geminiApiKey?: string; anthropicApiKey?: string
  openrouterApiKey?: string; modalApiKey?: string
}

export interface VisionTarget { provider: string; model: string; apiKey: string }

/** Resolve provider+modelo+chave para a chamada de visão. Em Ollama usa um
 *  modelo de VISÃO (settings.visionModel || 'llava') — o modelo de chat local
 *  costuma ser só-texto; na nuvem usa o modelo configurado do provider (gpt-4o/
 *  gemini/claude/etc. são multimodais). Devolve `null` se o provider não suporta
 *  visão (ex.: custom) — o chamador então explica em vez de falhar feio. */
export function resolveVisionTarget(s: VisionSettingsLike | undefined): VisionTarget | null {
  const provider = s?.provider || 'ollama'
  if (!VISION_PROVIDERS.has(provider)) return null
  if (provider === 'ollama') {
    return { provider, model: (s?.visionModel || '').trim() || DEFAULT_VISION_OLLAMA_MODEL, apiKey: '' }
  }
  const model =
    provider === 'openai' ? s?.openaiModel :
    provider === 'gemini' ? s?.geminiModel :
    provider === 'anthropic' ? s?.anthropicModel :
    provider === 'openrouter' ? s?.openrouterModel :
    provider === 'modal' ? s?.modalModel : ''
  const apiKey =
    provider === 'openai' ? s?.openaiApiKey :
    provider === 'gemini' ? s?.geminiApiKey :
    provider === 'anthropic' ? s?.anthropicApiKey :
    provider === 'openrouter' ? s?.openrouterApiKey :
    provider === 'modal' ? s?.modalApiKey : ''
  return { provider, model: (model || '').trim(), apiKey: apiKey || '' }
}

/** Formata o resultado da análise para o modelo (ou um erro acionável). */
export function formatVisionResult(
  res: { response?: string | null; error?: string | null } | null | undefined,
  label: string,
): string {
  if (!res || res.error) {
    return `Não consegui analisar ${label}: ${res?.error || 'sem resposta do modelo de visão'}.`
  }
  const text = (res.response || '').trim()
  if (!text) return `O modelo de visão não retornou descrição para ${label}.`
  return `Análise de ${label}:\n\n${text}`
}
