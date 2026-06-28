// ─── Ponte do app do celular (PWA) ↔ motor de chat do desktop — v2.191.0 ──
//
// O servidor remoto (electron/remote-server.js) roda no MAIN, que NÃO tem as
// chaves de API. Elas — e o motor de chat — vivem aqui no renderer. Quando o
// celular manda um pedido, o main reencaminha ('remote-chat-request') e o
// renderer resolve a config (provider/modelo/chave) a partir das SETTINGS LOCAIS
// e roda o chat. Estes helpers PUROS fazem essa resolução (testados); o hook
// useRemoteBridge faz o IPC.
//
// Regra de segurança: a chave de API vem SEMPRE do settings local, NUNCA do
// payload do celular. O celular só pode escolher provider/modelo (entre os que o
// usuário já configurou); sem chave, a chamada simplesmente falha — nada vaza.

import type { AppSettings } from '../types'
import { providerApiKey } from './compareModels'

export interface RemoteChatPayload {
  messages: { role: string; content: string }[]
  model?: string
  provider?: string
}

export interface RemoteResolved {
  provider: string
  model: string
  apiKey: string
  isNotOllama: boolean
  modalHostname?: string
  customBaseUrl?: string
}

/** Modelo padrão por provider (espelha useProviderConfig). Ollama usa o modelo
 *  atualmente selecionado no desktop (`fallbackModel`), pois não há campo fixo. */
export function defaultModelFor(settings: AppSettings, provider: string, fallbackModel = ''): string {
  switch (provider) {
    case 'anthropic': return settings.anthropicModel || 'claude-sonnet-4-20250514'
    case 'openai': return settings.openaiModel || 'gpt-4o'
    case 'gemini': return settings.geminiModel || 'gemini-2.0-flash'
    case 'openrouter': return settings.openrouterModel || 'google/gemini-2.5-pro'
    case 'modal': return settings.modalModel || 'zai-org/GLM-5.1-FP8'
    case 'custom': return settings.customModel || ''
    default: return fallbackModel // ollama (local)
  }
}

export interface RemoteTarget { id: string; label: string; provider: string; model: string }

const CLOUD_PROVIDERS = ['modal', 'anthropic', 'openai', 'gemini', 'openrouter', 'custom'] as const

/** Alvos que o celular pode escolher. Sempre oferece TODOS os provedores
 *  configurados (a IA local Ollama + cada provedor de nuvem com chave, ex. Modal)
 *  — assim o usuário troca livremente no celular. O provedor ATIVO no desktop vem
 *  primeiro (vira o padrão). A chave nunca vai pro celular; fica no desktop. */
export function buildRemoteTargets(settings: AppSettings, selectedModel: string): RemoteTarget[] {
  const targets: RemoteTarget[] = []
  const seen = new Set<string>()
  const labelFor = (provider: string, model: string) =>
    provider === 'ollama' ? `Ollama (local): ${model}` : `${provider}: ${model}`
  const add = (id: string, provider: string, model: string) => {
    if (!model) return
    const sig = `${provider}:${model}`
    if (seen.has(sig)) return
    seen.add(sig)
    targets.push({ id, label: labelFor(provider, model), provider, model })
  }
  // 1) provedor ATIVO no desktop primeiro → é o padrão no celular.
  const cur = settings.provider || 'ollama'
  add('main', cur, cur === 'ollama' ? selectedModel : defaultModelFor(settings, cur, selectedModel))
  // 2) IA local (Ollama) com o modelo selecionado no desktop.
  if (selectedModel) add('ollama', 'ollama', selectedModel)
  // 3) cada provedor de nuvem que TEM chave configurada (ex.: Modal/GLM).
  for (const p of CLOUD_PROVIDERS) {
    if (providerApiKey(settings as any, p)) add(p, p, defaultModelFor(settings, p, ''))
  }
  return targets.length ? targets : [{ id: 'main', label: 'Ollama (local)', provider: 'ollama', model: selectedModel || '' }]
}

/** Resolve a config de provider para um pedido do celular. O payload pode
 *  sobrescrever provider/model; a CHAVE vem sempre do settings local. */
export function resolveRemoteConfig(
  settings: AppSettings,
  payload: RemoteChatPayload,
  fallbackModel = '',
): RemoteResolved {
  const provider = (payload?.provider && String(payload.provider).trim()) || settings.provider || 'ollama'
  const model = (payload?.model && String(payload.model).trim()) || defaultModelFor(settings, provider, fallbackModel)
  return {
    provider,
    model,
    apiKey: providerApiKey(settings as any, provider),
    isNotOllama: provider !== 'ollama',
    modalHostname: provider === 'modal' ? settings.modalHostname : undefined,
    customBaseUrl: provider === 'custom' ? settings.customBaseUrl : undefined,
  }
}
