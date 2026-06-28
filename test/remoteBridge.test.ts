import { describe, it, expect } from 'vitest'
import { resolveRemoteConfig, defaultModelFor } from '../src/utils/remoteBridge'
import type { AppSettings } from '../src/types'

// Settings mínimo só com os campos que o helper lê.
const S = (over: Partial<AppSettings>): AppSettings => ({
  provider: 'ollama',
  anthropicApiKey: '', openaiApiKey: '', geminiApiKey: '',
  openrouterApiKey: '', modalApiKey: '', customApiKey: '',
  anthropicModel: '', openaiModel: '', geminiModel: '',
  openrouterModel: '', modalModel: '', customModel: '',
  modalHostname: '', customBaseUrl: '',
  ...over,
} as AppSettings)

describe('defaultModelFor', () => {
  it('uses the configured model per provider', () => {
    expect(defaultModelFor(S({ anthropicModel: 'claude-x' }), 'anthropic')).toBe('claude-x')
    expect(defaultModelFor(S({ openaiModel: 'gpt-x' }), 'openai')).toBe('gpt-x')
  })
  it('falls back to a sensible default when the provider model is unset', () => {
    expect(defaultModelFor(S({}), 'openai')).toBe('gpt-4o')
    expect(defaultModelFor(S({}), 'gemini')).toBe('gemini-2.0-flash')
  })
  it('uses the desktop-selected model for ollama (no fixed field)', () => {
    expect(defaultModelFor(S({}), 'ollama', 'llama3-local')).toBe('llama3-local')
  })
})

describe('resolveRemoteConfig', () => {
  it('defaults to the desktop provider + model when the phone specifies nothing', () => {
    const r = resolveRemoteConfig(S({ provider: 'openai', openaiModel: 'gpt-4o', openaiApiKey: 'sk-1' }), { messages: [] })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('gpt-4o')
    expect(r.apiKey).toBe('sk-1')
    expect(r.isNotOllama).toBe(true)
  })
  it('lets the phone override provider + model, but the KEY still comes from local settings', () => {
    const r = resolveRemoteConfig(
      S({ provider: 'ollama', anthropicApiKey: 'sk-ant' }),
      { messages: [], provider: 'anthropic', model: 'claude-opus' },
    )
    expect(r.provider).toBe('anthropic')
    expect(r.model).toBe('claude-opus')
    expect(r.apiKey).toBe('sk-ant') // from settings, NOT the payload
  })
  it('never takes an apiKey from the phone payload', () => {
    const r = resolveRemoteConfig(
      S({ provider: 'openai', openaiApiKey: 'real-key' }),
      { messages: [], provider: 'openai', ...( { apiKey: 'attacker-key' } as any) },
    )
    expect(r.apiKey).toBe('real-key')
  })
  it('marks ollama as local (isNotOllama=false) with the selected model', () => {
    const r = resolveRemoteConfig(S({ provider: 'ollama' }), { messages: [] }, 'qwen-local')
    expect(r.provider).toBe('ollama')
    expect(r.isNotOllama).toBe(false)
    expect(r.model).toBe('qwen-local')
    expect(r.apiKey).toBe('')
  })
  it('passes modalHostname only for modal, customBaseUrl only for custom', () => {
    const modal = resolveRemoteConfig(S({ provider: 'modal', modalApiKey: 'm', modalModel: 'glm', modalHostname: 'h.modal' }), { messages: [] })
    expect(modal.modalHostname).toBe('h.modal')
    expect(modal.customBaseUrl).toBeUndefined()
    const custom = resolveRemoteConfig(S({ provider: 'custom', customApiKey: 'c', customModel: 'cm', customBaseUrl: 'https://x/v1' }), { messages: [] })
    expect(custom.customBaseUrl).toBe('https://x/v1')
    expect(custom.modalHostname).toBeUndefined()
  })
})
