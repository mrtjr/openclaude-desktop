import { describe, it, expect } from 'vitest'
import { PROVIDERS, buildOnboardingUpdates } from '../src/components/OnboardingModal'

describe('onboarding PROVIDERS', () => {
  it('includes Modal — the provider this user actually runs', () => {
    const modal = PROVIDERS.find(p => p.id === 'modal')
    expect(modal).toBeDefined()
    expect(modal!.keyField).toBe('modalApiKey')
    expect(modal!.hostnameField).toBe('modalHostname')
    expect(modal!.hostnameDefault).toBeTruthy()
  })
})

describe('buildOnboardingUpdates', () => {
  const modal = PROVIDERS.find(p => p.id === 'modal')!
  const ollama = PROVIDERS.find(p => p.id === 'ollama')!
  const openai = PROVIDERS.find(p => p.id === 'openai')!

  it('writes the provider plus its API key', () => {
    const u = buildOnboardingUpdates(openai, 'sk-proj-abc')
    expect(u).toEqual({ provider: 'openai', openaiApiKey: 'sk-proj-abc' })
  })

  it('writes BOTH the key and hostname for Modal', () => {
    const u = buildOnboardingUpdates(modal, 'modalresearch_x', 'api.us-west-2.modal.direct') as any
    expect(u.provider).toBe('modal')
    expect(u.modalApiKey).toBe('modalresearch_x')
    expect(u.modalHostname).toBe('api.us-west-2.modal.direct')
  })

  it('trims the hostname and omits it when blank', () => {
    expect((buildOnboardingUpdates(modal, 'k', '  host  ') as any).modalHostname).toBe('host')
    expect((buildOnboardingUpdates(modal, 'k', '   ') as any).modalHostname).toBeUndefined()
  })

  it('omits the key for a local-only provider', () => {
    expect(buildOnboardingUpdates(ollama, null)).toEqual({ provider: 'ollama' })
  })
})
