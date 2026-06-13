import { describe, it, expect } from 'vitest'
import { buildSwitchOptions, groupSwitchOptions, providerConfigured } from '../src/utils/modelSwitcher'
import { DEFAULT_SETTINGS } from '../src/settingsConfig'
import type { AppSettings } from '../src/types'

const base = (over: Partial<AppSettings>): AppSettings => ({ ...DEFAULT_SETTINGS, ...over } as AppSettings)

describe('providerConfigured', () => {
  it('ollama é sempre disponível; cloud só com credencial', () => {
    const s = base({ modalApiKey: '', anthropicApiKey: '' })
    expect(providerConfigured(s, 'ollama')).toBe(true)
    expect(providerConfigured(s, 'modal')).toBe(false)
    expect(providerConfigured(base({ modalApiKey: 'k' }), 'modal')).toBe(true)
    expect(providerConfigured(base({ modalApiKeys: [{ id: '1', label: 'a', key: 'k' } as any] }), 'modal')).toBe(true)
    expect(providerConfigured(base({ anthropicApiKey: 'k' }), 'anthropic')).toBe(true)
    expect(providerConfigured(base({ customBaseUrl: 'http://x/v1' }), 'custom')).toBe(true)
  })
})

describe('buildSwitchOptions — Modal + Ollama (o caso do usuário)', () => {
  it('lista cada modelo Ollama + o Modal configurado, marcando o ativo', () => {
    const s = base({ provider: 'modal', modalApiKey: 'k', modalModel: 'zai-org/GLM-5.1-FP8' })
    const opts = buildSwitchOptions(s, ['qwen3', 'llama3'], 'qwen3')
    // duas entradas ollama + uma modal
    expect(opts.filter(o => o.provider === 'ollama')).toHaveLength(2)
    const modal = opts.find(o => o.provider === 'modal')!
    expect(modal.active).toBe(true)
    expect(modal.label).toBe('zai-org/GLM-5.1-FP8')
    // nenhum ollama ativo (provider atual é modal)
    expect(opts.filter(o => o.provider === 'ollama' && o.active)).toHaveLength(0)
  })

  it('com provider=ollama, marca o modelo selecionado e não o modal', () => {
    const s = base({ provider: 'ollama', modalApiKey: 'k' })
    const opts = buildSwitchOptions(s, ['qwen3', 'llama3'], 'llama3')
    expect(opts.find(o => o.provider === 'ollama' && o.model === 'llama3')!.active).toBe(true)
    expect(opts.find(o => o.provider === 'ollama' && o.model === 'qwen3')!.active).toBe(false)
    expect(opts.find(o => o.provider === 'modal')!.active).toBe(false)
  })

  it('oculta cloud sem credencial, mas mantém o provider ATUAL mesmo sem ela', () => {
    const s = base({ provider: 'modal', modalApiKey: '', anthropicApiKey: '' })
    const opts = buildSwitchOptions(s, ['qwen3'], 'qwen3')
    expect(opts.find(o => o.provider === 'modal')).toBeTruthy()   // atual, mostrado
    expect(opts.find(o => o.provider === 'anthropic')).toBeUndefined() // sem cred, oculto
  })

  it('usa o selectedModel como fallback quando a lista Ollama não carregou', () => {
    const s = base({ provider: 'ollama' })
    const opts = buildSwitchOptions(s, [], 'qwen35-uncensored')
    const oll = opts.filter(o => o.provider === 'ollama')
    expect(oll).toHaveLength(1)
    expect(oll[0].model).toBe('qwen35-uncensored')
    expect(oll[0].active).toBe(true)
  })

  it('inclui múltiplos providers cloud configurados', () => {
    const s = base({ provider: 'modal', modalApiKey: 'k', anthropicApiKey: 'a', openaiApiKey: 'o' })
    const opts = buildSwitchOptions(s, [], '')
    const providers = new Set(opts.map(o => o.provider))
    expect(providers.has('modal')).toBe(true)
    expect(providers.has('anthropic')).toBe(true)
    expect(providers.has('openai')).toBe(true)
  })
})

describe('groupSwitchOptions', () => {
  it('agrupa por provider preservando a ordem de inserção', () => {
    const s = base({ provider: 'modal', modalApiKey: 'k' })
    const grouped = groupSwitchOptions(buildSwitchOptions(s, ['qwen3'], 'qwen3'))
    expect(grouped[0].group).toBe('Ollama (local)')
    expect(grouped[1].group).toBe('Modal')
    expect(grouped[1].items[0].provider).toBe('modal')
  })
})
