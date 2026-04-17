import { describe, it, expect } from 'vitest'
import { PROVIDERS, getProviderMeta } from '../src/config/providers'
import { DEFAULT_SETTINGS } from '../src/Settings'

describe('providers.config', () => {
  it('exports all 7 known providers', () => {
    const ids = PROVIDERS.map(p => p.id).sort()
    expect(ids).toEqual(
      ['anthropic', 'custom', 'gemini', 'modal', 'ollama', 'openai', 'openrouter']
    )
  })

  it('each provider has a non-empty label, tagline, and accent color', () => {
    for (const p of PROVIDERS) {
      expect(p.label).toBeTruthy()
      expect(p.tagline.pt).toBeTruthy()
      expect(p.tagline.en).toBeTruthy()
      expect(p.accent).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('every provider with fields points to a valid AppSettings key', () => {
    for (const p of PROVIDERS) {
      if (!p.fields) continue
      expect(p.fields.apiKeySetting in DEFAULT_SETTINGS).toBe(true)
      expect(p.fields.modelSetting in DEFAULT_SETTINGS).toBe(true)
      if (p.fields.extra) {
        expect(p.fields.extra.setting in DEFAULT_SETTINGS).toBe(true)
      }
    }
  })

  it('ollama is the only provider without a key field', () => {
    const withoutFields = PROVIDERS.filter(p => !p.fields).map(p => p.id)
    expect(withoutFields).toEqual(['ollama'])
  })

  it('modal is the only provider with supportsKeyPool', () => {
    const withPool = PROVIDERS.filter(p => p.supportsKeyPool).map(p => p.id)
    expect(withPool).toEqual(['modal'])
  })

  it('custom is the only provider with isCustomBaseUrl', () => {
    const withBaseUrl = PROVIDERS.filter(p => p.isCustomBaseUrl).map(p => p.id)
    expect(withBaseUrl).toEqual(['custom'])
  })

  it('getProviderMeta returns correct entry by id', () => {
    expect(getProviderMeta('openai').label).toBe('OpenAI')
    expect(getProviderMeta('modal').supportsKeyPool).toBe(true)
  })

  it('getProviderMeta falls back to first provider on unknown id', () => {
    // @ts-expect-error intentionally bogus
    const meta = getProviderMeta('unknown-provider')
    expect(meta.id).toBe(PROVIDERS[0].id)
  })
})
