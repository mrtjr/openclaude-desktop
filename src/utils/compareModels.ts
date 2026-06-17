// ─── Comparar modelos no chat (fusão do ModelArena — v2.75.0) ───────
//
// O ModelArena roda o mesmo prompt em vários modelos lado a lado num painel.
// Aqui a capacidade vira a ferramenta compare_models: a IA dispara o MESMO
// prompt em N modelos (mesmo provider ou cross-provider) e recebe as respostas
// rotuladas para SINTETIZAR/comparar (qual respondeu melhor, divergências). O
// painel ModelArena segue vivo para a votação/placar (ELO).
//
// Helpers PUROS/testáveis: normalizar a lista de modelos, resolver a chave por
// provider, extrair o texto da resposta (3 shapes) e formatar a comparação. O
// IPC (providerChat) é injetado pelo chamador.

/** Teto de modelos por comparação — chamadas a provider de nuvem custam; sem
 *  teto a IA poderia disparar dezenas de uma vez. */
export const MAX_COMPARE_MODELS = 4

export interface ModelSpec { provider: string; model: string }

export interface CompareSettingsLike {
  provider?: string
  openaiApiKey?: string; geminiApiKey?: string; anthropicApiKey?: string
  openrouterApiKey?: string; modalApiKey?: string; customApiKey?: string
}

/** Normaliza `args.models` (lista de strings OU de {model, provider?}) em specs
 *  {provider, model}. provider ausente → o atual. Descarta inválidos, dedup por
 *  provider:model, corta no teto. */
export function parseCompareSpecs(
  models: unknown,
  defaultProvider: string,
  max = MAX_COMPARE_MODELS,
): ModelSpec[] {
  if (!Array.isArray(models)) return []
  const out: ModelSpec[] = []
  const seen = new Set<string>()
  for (const m of models) {
    let provider = defaultProvider
    let model = ''
    if (typeof m === 'string') {
      model = m.trim()
    } else if (m && typeof m === 'object') {
      model = String((m as any).model ?? '').trim()
      const p = String((m as any).provider ?? '').trim()
      if (p) provider = p
    }
    if (!model) continue
    const key = `${provider}:${model}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ provider, model })
    if (out.length >= max) break
  }
  return out
}

/** Chave de API do provider (vazia p/ Ollama, que é local). */
export function providerApiKey(s: CompareSettingsLike | undefined, provider: string): string {
  switch (provider) {
    case 'openai': return s?.openaiApiKey || ''
    case 'gemini': return s?.geminiApiKey || ''
    case 'anthropic': return s?.anthropicApiKey || ''
    case 'openrouter': return s?.openrouterApiKey || ''
    case 'modal': return s?.modalApiKey || ''
    case 'custom': return s?.customApiKey || ''
    default: return '' // ollama
  }
}

/** Extrai o texto da resposta do providerChat, tolerando os 3 shapes
 *  (OpenAI-compat / Anthropic / Gemini). */
export function extractChatText(res: any): string {
  return (
    res?.choices?.[0]?.message?.content ??
    res?.content?.[0]?.text ??
    res?.candidates?.[0]?.content?.parts?.[0]?.text ??
    ''
  ) || ''
}

export interface CompareResult { provider: string; model: string; text: string; ms: number; error?: string | null }

/** Formata as respostas lado a lado para a IA comparar e sintetizar. */
export function formatComparison(prompt: string, results: CompareResult[]): string {
  if (!results.length) return 'compare_models: nenhum modelo válido para comparar.'
  const blocks = results.map((r) => {
    const head = `### ${r.model} (${r.provider}) — ${(r.ms / 1000).toFixed(1)}s`
    if (r.error) return `${head}\n[erro: ${r.error}]`
    const body = (r.text || '').trim()
    return `${head}\n${body || '[resposta vazia]'}`
  })
  return [
    `Comparação de modelos para o mesmo prompt: "${prompt}"`,
    '',
    blocks.join('\n\n'),
    '',
    'Sintetize: aponte semelhanças, divergências factuais e qual resposta é mais correta/completa (e por quê). Não invente conteúdo que nenhum modelo trouxe.',
  ].join('\n')
}
