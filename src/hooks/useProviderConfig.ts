import { useMemo } from 'react'
import type { AppSettings } from '../types'

export interface ProviderConfig {
  provider: string
  model: string
  apiKey: string
  isNotOllama: boolean
  modalHostname?: string
  /** Custom OpenAI-compatible base URL (e.g. https://api.groq.com/openai/v1) */
  customBaseUrl?: string
}

export function useProviderConfig(settings: AppSettings, selectedModel: string): ProviderConfig {
  return useMemo(() => {
    const provider = settings.provider || 'ollama'
    let model = selectedModel
    let apiKey = ''
    let modalHostname: string | undefined
    let customBaseUrl: string | undefined

    if (provider === 'anthropic') {
      model = settings.anthropicModel || 'claude-sonnet-4-20250514'
      apiKey = settings.anthropicApiKey
    } else if (provider === 'openai') {
      model = settings.openaiModel || 'gpt-4o'
      apiKey = settings.openaiApiKey
    } else if (provider === 'gemini') {
      model = settings.geminiModel || 'gemini-2.0-flash'
      apiKey = settings.geminiApiKey
    } else if (provider === 'openrouter') {
      model = settings.openrouterModel || 'google/gemini-2.5-pro'
      apiKey = settings.openrouterApiKey
    } else if (provider === 'modal') {
      model = settings.modalModel || 'zai-org/GLM-5.1-FP8'
      apiKey = settings.modalApiKey
      modalHostname = settings.modalHostname
    } else if (provider === 'custom') {
      model = settings.customModel || ''
      apiKey = settings.customApiKey
      customBaseUrl = settings.customBaseUrl
    }

    return {
      provider,
      model,
      apiKey,
      isNotOllama: provider !== 'ollama',
      modalHostname,
      customBaseUrl,
    }
  }, [settings, selectedModel])
}

/** Get display model name for the current provider */
export function getDisplayModel(settings: AppSettings, selectedModel: string): string {
  if (settings.provider === 'ollama') return selectedModel
  if (settings.provider === 'anthropic') return settings.anthropicModel
  if (settings.provider === 'openai') return settings.openaiModel
  if (settings.provider === 'openrouter') return settings.openrouterModel
  if (settings.provider === 'modal') return settings.modalModel
  if (settings.provider === 'custom') return settings.customModel
  return settings.geminiModel
}
