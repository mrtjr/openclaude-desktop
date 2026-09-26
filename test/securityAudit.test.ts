import { describe, it, expect } from 'vitest'
import { runSecurityAudit, maskSecrets } from '../src/utils/securityAudit'
import type { AppSettings } from '../src/types'

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    provider: 'ollama',
    permissionLevel: 'ask',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: '',
    memoryEnabled: false,
    mcpServers: [],
    openaiApiKey: '', anthropicApiKey: '', geminiApiKey: '',
    openrouterApiKey: '', modalApiKey: '',
    ...overrides,
  } as AppSettings
}

describe('runSecurityAudit', () => {
  it('returns an all-clear finding when nothing is off', () => {
    const findings = runSecurityAudit(baseSettings())
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('all-clear')
    expect(findings[0].severity).toBe('info')
  })

  it('flags permission-bypass mode as danger', () => {
    const findings = runSecurityAudit(baseSettings({ permissionLevel: 'ignore' as any }))
    const bypass = findings.find(f => f.id === 'perm-bypass')
    expect(bypass).toBeDefined()
    expect(bypass?.severity).toBe('danger')
  })

  it('warns about API keys in localStorage and lists providers', () => {
    const findings = runSecurityAudit(baseSettings({
      openaiApiKey: 'sk-a', anthropicApiKey: 'sk-b',
    }))
    const keys = findings.find(f => f.id === 'api-keys-storage')
    expect(keys?.severity).toBe('warn')
    expect(keys?.title).toContain('2')
    expect(keys?.description).toContain('OpenAI')
    expect(keys?.description).toContain('Anthropic')
  })

  it('flags high temperature', () => {
    const findings = runSecurityAudit(baseSettings({ temperature: 1.8 }))
    expect(findings.find(f => f.id === 'high-temp')).toBeDefined()
  })

  it('flags very long system prompts as info', () => {
    const findings = runSecurityAudit(baseSettings({ systemPrompt: 'x'.repeat(2500) }))
    const long = findings.find(f => f.id === 'long-system-prompt')
    expect(long?.severity).toBe('info')
  })

  it('flags MCP servers as warn and names them', () => {
    const findings = runSecurityAudit(baseSettings({
      mcpServers: [{ name: 'custom-sh', command: 'sh' } as any],
    }))
    const mcp = findings.find(f => f.id === 'mcp-servers')
    expect(mcp?.severity).toBe('warn')
    expect(mcp?.description).toContain('custom-sh')
  })

  it('sorts findings with danger first, then warn, then info', () => {
    const findings = runSecurityAudit(baseSettings({
      permissionLevel: 'ignore' as any,   // danger
      openaiApiKey: 'sk-a',                // warn
      memoryEnabled: true,                 // info
    }))
    const severities = findings.map(f => f.severity)
    // check monotonic by severity order danger < warn < info
    const order = { danger: 0, warn: 1, info: 2 }
    for (let i = 1; i < severities.length; i++) {
      expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]])
    }
  })
})

describe('maskSecrets', () => {
  it('should mask OpenAI API key', () => {
    const input = 'My key is sk-proj-12345ABCD67890efgh1234567890'
    const expected = 'My key is sk-***'
    expect(maskSecrets(input)).toBe(expected)
  })

  it('should mask Anthropic API key', () => {
    const input = 'Anthropic key: sk-ant-api03-abcdefGHIJKL-1234567890ABCDEF'
    const expected = 'Anthropic key: sk-ant-api***'
    expect(maskSecrets(input)).toBe(expected)
  })

  it('should mask Google Gemini and Bearer mixed with text', () => {
    // Chave FALSA montada em partes: o literal inteiro tem o formato exato de
    // API key do Google e dispara a proteção contra segredos do GitHub no push.
    const input = 'Normal text with Gemini AIza' + 'Sy1234567890abcdefghijklmnopqrstuvw and a Bearer abcde1234567890ABCDEF mixed.'
    const expected = 'Normal text with Gemini AIza*** and a Bearer *** mixed.'
    expect(maskSecrets(input)).toBe(expected)
  })

  it('should not alter legitimate safe text', () => {
    const input = 'This is a completely safe string without any secrets!'
    expect(maskSecrets(input)).toBe(input)
  })

  it('mascara a chave sk-proj INTEIRA mesmo com sublinhado', () => {
    const input = 'key=sk-proj-abc123_DEF456-ghi789_JKL012mno345 fim'
    expect(maskSecrets(input)).toBe('key=sk-*** fim')
  })
})
