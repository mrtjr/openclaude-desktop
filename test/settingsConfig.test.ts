import { describe, it, expect, beforeEach } from 'vitest'
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/settingsConfig'

describe('settingsConfig — loadSettings / saveSettings', () => {
  beforeEach(() => localStorage.clear())

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges stored values over defaults, leaving the rest intact', () => {
    localStorage.setItem('openclaude-settings', JSON.stringify({ temperature: 0.1, provider: 'openai' }))
    const s = loadSettings()
    expect(s.temperature).toBe(0.1)
    expect(s.provider).toBe('openai')
    expect(s.maxTokens).toBe(DEFAULT_SETTINGS.maxTokens)
  })

  it('migrates a legacy single modalApiKey into the modalApiKeys array', () => {
    localStorage.setItem('openclaude-settings', JSON.stringify({ modalApiKey: 'ak_123', modalApiKeys: [] }))
    const keys = loadSettings().modalApiKeys
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ key: 'ak_123', enabled: true })
  })

  it('upgrades a stale (404-ing) modalModel to the real default', () => {
    localStorage.setItem('openclaude-settings', JSON.stringify({ modalModel: 'llama-3.1-70b' }))
    expect(loadSettings().modalModel).toBe(DEFAULT_SETTINGS.modalModel)
  })

  it('respects an explicit toolDeferralMode and defaults to auto otherwise', () => {
    localStorage.setItem('openclaude-settings', JSON.stringify({ toolDeferralMode: 'off' }))
    expect(loadSettings().toolDeferralMode).toBe('off')
    localStorage.setItem('openclaude-settings', JSON.stringify({ provider: 'ollama' }))
    expect(loadSettings().toolDeferralMode).toBe('auto')
  })

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('openclaude-settings', '{ corrupt')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('saveSettings round-trips through loadSettings', () => {
    saveSettings({ ...DEFAULT_SETTINGS, temperature: 0.42, profileName: 'Júnior' })
    const s = loadSettings()
    expect(s.temperature).toBe(0.42)
    expect(s.profileName).toBe('Júnior')
  })
})
