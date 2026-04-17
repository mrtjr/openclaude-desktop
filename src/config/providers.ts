// ─── Provider registry — single source of truth ──────────────────
// Declarative metadata for each AI provider. Used by ProviderList,
// ProviderDetail, and any future provider-aware UI to avoid duplication.
//
// Add a new provider by appending an entry here — no component edits needed.

import type { Provider } from '../Settings'

export interface ProviderFieldSpec {
  /** Key in AppSettings for the API key (password field). */
  apiKeySetting: keyof import('../Settings').AppSettings
  /** Key in AppSettings for the model (text + datalist). */
  modelSetting: keyof import('../Settings').AppSettings
  /** Optional extra field (e.g. baseUrl, hostname). */
  extra?: {
    setting: keyof import('../Settings').AppSettings
    label: { pt: string; en: string }
    placeholder: string
  }
}

export interface ProviderMeta {
  id: Provider
  label: string
  /** Short tagline shown under the label in the list. */
  tagline: { pt: string; en: string }
  /** Accent color used for the health dot / chip. */
  accent: string
  /** Optional "get a key" URL opened in system browser. */
  docUrl?: string
  /** Placeholder shown in the key input (hint for key format). */
  keyPlaceholder: string
  /** Default models shown in the datalist when no fetch has happened. */
  defaultModels: string[]
  /** Field mappings into AppSettings. `null` for providers without a key (Ollama). */
  fields: ProviderFieldSpec | null
  /** True if this provider supports parallel subagents via a key pool. */
  supportsKeyPool?: boolean
  /** True if this provider is OpenAI-wire-compatible (user can supply own base URL). */
  isCustomBaseUrl?: boolean
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    tagline: { pt: 'Local, sem API key', en: 'Local, no API key' },
    accent: '#94a3b8',
    docUrl: 'https://ollama.com/download',
    keyPlaceholder: '',
    defaultModels: ['llama3.2', 'qwen2.5-coder', 'mistral'],
    fields: null,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    tagline: { pt: 'Claude Sonnet, Opus, Haiku', en: 'Claude Sonnet, Opus, Haiku' },
    accent: '#d97706',
    docUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    defaultModels: [
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
    ],
    fields: {
      apiKeySetting: 'anthropicApiKey',
      modelSetting: 'anthropicModel',
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    tagline: { pt: 'GPT-4o, o1, o3', en: 'GPT-4o, o1, o3' },
    accent: '#10a37f',
    docUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-3.5-turbo'],
    fields: {
      apiKeySetting: 'openaiApiKey',
      modelSetting: 'openaiModel',
    },
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    tagline: { pt: 'Gemini 2.0 Flash, 1.5 Pro', en: 'Gemini 2.0 Flash, 1.5 Pro' },
    accent: '#4285f4',
    docUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza...',
    defaultModels: [
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    fields: {
      apiKeySetting: 'geminiApiKey',
      modelSetting: 'geminiModel',
    },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: { pt: '400+ modelos, 1 key', en: '400+ models, 1 key' },
    accent: '#8b5cf6',
    docUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-...',
    defaultModels: [
      'google/gemini-2.5-pro',
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    fields: {
      apiKeySetting: 'openrouterApiKey',
      modelSetting: 'openrouterModel',
    },
  },
  {
    id: 'modal',
    label: 'Modal Research',
    tagline: { pt: 'OSS models, pool paralelo', en: 'OSS models, parallel pool' },
    accent: '#7e22ce',
    docUrl: 'https://modal.com',
    keyPlaceholder: 'modalresearch_...',
    defaultModels: [
      'zai-org/GLM-5.1-FP8',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'deepseek-ai/DeepSeek-V3',
    ],
    fields: {
      apiKeySetting: 'modalApiKey',
      modelSetting: 'modalModel',
      extra: {
        setting: 'modalHostname',
        label: { pt: 'Hostname', en: 'Hostname' },
        placeholder: 'api.us-west-2.modal.direct',
      },
    },
    supportsKeyPool: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    tagline: { pt: 'Groq, Together, Fireworks, DeepInfra…', en: 'Groq, Together, Fireworks, DeepInfra…' },
    accent: '#0ea5e9',
    docUrl: 'https://platform.openai.com/docs/api-reference',
    keyPlaceholder: 'sk-...',
    defaultModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
    ],
    fields: {
      apiKeySetting: 'customApiKey',
      modelSetting: 'customModel',
      extra: {
        setting: 'customBaseUrl',
        label: { pt: 'Base URL', en: 'Base URL' },
        placeholder: 'https://api.groq.com/openai/v1',
      },
    },
    isCustomBaseUrl: true,
  },
]

export function getProviderMeta(id: Provider): ProviderMeta {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0]
}
