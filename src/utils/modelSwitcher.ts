// ─── Troca rápida de modelo/provider no chat (v2.23.0) ──────────────
//
// Antes, alternar entre Modal e Ollama exigia abrir Configurações e mudar o
// provider. Este helper monta a lista de opções "trocáveis" diretamente no
// chat (estilo Claude): cada provider COM credencial vira uma ou mais entradas
// (Ollama expande para cada modelo local; cloud = o modelo configurado),
// agrupadas por provider, com a opção ativa marcada. Puro/testável — a UI só
// renderiza e dispara a troca.

import type { AppSettings } from '../types'

export interface SwitchOption {
  provider: string
  model: string
  /** Texto exibido na linha. */
  label: string
  /** Cabeçalho do grupo (provider). */
  group: string
  /** É a seleção atual? (recebe o check) */
  active: boolean
  /** Ollama roda local; usado para o ícone e para o gate "sempre disponível". */
  local: boolean
}

/** Um provider só entra na lista se tiver credencial configurada (ou for o
 *  Ollama, que é local). O provider ATUAL sempre entra, mesmo sem credencial,
 *  para a UI refletir a verdade. */
export function providerConfigured(settings: AppSettings, p: string): boolean {
  switch (p) {
    case 'ollama': return true
    case 'modal': return !!(settings.modalApiKey || (settings.modalApiKeys && settings.modalApiKeys.length > 0))
    case 'anthropic': return !!settings.anthropicApiKey
    case 'openai': return !!settings.openaiApiKey
    case 'openrouter': return !!settings.openrouterApiKey
    case 'gemini': return !!settings.geminiApiKey
    case 'custom': return !!settings.customBaseUrl
    default: return false
  }
}

const CLOUD: Array<{ p: string; group: string; modelKey: keyof AppSettings }> = [
  { p: 'modal', group: 'Modal', modelKey: 'modalModel' },
  { p: 'anthropic', group: 'Anthropic', modelKey: 'anthropicModel' },
  { p: 'openai', group: 'OpenAI', modelKey: 'openaiModel' },
  { p: 'openrouter', group: 'OpenRouter', modelKey: 'openrouterModel' },
  { p: 'gemini', group: 'Gemini', modelKey: 'geminiModel' },
  { p: 'custom', group: 'Custom', modelKey: 'customModel' },
]

/** Monta as opções de troca rápida. `ollamaModels` é a lista de modelos locais
 *  detectados; `selectedModel` é o modelo Ollama ativo. */
export function buildSwitchOptions(
  settings: AppSettings,
  ollamaModels: string[],
  selectedModel: string,
): SwitchOption[] {
  const cur = settings.provider
  const opts: SwitchOption[] = []

  // Ollama: uma entrada por modelo local (ou o selecionado, se a lista ainda
  // não carregou). É sempre listado — local e sem custo.
  const locals = ollamaModels.length ? ollamaModels : (selectedModel ? [selectedModel] : [])
  for (const m of locals) {
    opts.push({
      provider: 'ollama', model: m, label: m, group: 'Ollama (local)',
      active: cur === 'ollama' && m === selectedModel, local: true,
    })
  }

  // Cloud: só os configurados (ou o atual, para refletir a verdade).
  for (const c of CLOUD) {
    if (!providerConfigured(settings, c.p) && cur !== c.p) continue
    const model = String(settings[c.modelKey] || '')
    opts.push({
      provider: c.p, model, label: model || c.p, group: c.group,
      active: cur === c.p, local: false,
    })
  }

  return opts
}

/** Agrupa as opções por `group`, preservando a ordem de inserção — para a UI
 *  renderizar cabeçalhos estilo Claude ("Ollama (local)", "Modal", …). */
export function groupSwitchOptions(opts: SwitchOption[]): Array<{ group: string; items: SwitchOption[] }> {
  const order: string[] = []
  const byGroup = new Map<string, SwitchOption[]>()
  for (const o of opts) {
    if (!byGroup.has(o.group)) { byGroup.set(o.group, []); order.push(o.group) }
    byGroup.get(o.group)!.push(o)
  }
  return order.map(g => ({ group: g, items: byGroup.get(g)! }))
}
