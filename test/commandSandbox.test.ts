import { describe, it, expect } from 'vitest'
import { classifyCommand, splitCommands, DEFAULT_SANDBOX, type SandboxConfig } from '../src/utils/commandSandbox'

const cfg = (over: Partial<SandboxConfig> = {}): SandboxConfig => ({
  enabled: true,
  allowPrefixes: ['git status', 'git diff', 'npm test', 'ls', 'cat'],
  denyPatterns: ['rm -rf', 'sudo ', 'curl '],
  ...over,
})

describe('splitCommands', () => {
  it('quebra por &&, ||, |, ; e &', () => {
    expect(splitCommands('git status && npm test')).toEqual(['git status', 'npm test'])
    expect(splitCommands('cat a | grep x ; ls')).toEqual(['cat a', 'grep x', 'ls'])
  })
})

describe('classifyCommand', () => {
  it('desabilitado → sempre ask', () => {
    expect(classifyCommand('rm -rf /', cfg({ enabled: false }))).toBe('ask')
  })
  it('denylist bloqueia em qualquer posição', () => {
    expect(classifyCommand('rm -rf node_modules', cfg())).toBe('deny')
    expect(classifyCommand('echo ok && sudo reboot', cfg())).toBe('deny')
    expect(classifyCommand('curl http://x', cfg())).toBe('deny')
  })
  it('allowlist roda sem prompt só se TODAS as partes casam', () => {
    expect(classifyCommand('git status', cfg())).toBe('allow')
    expect(classifyCommand('git status && npm test', cfg())).toBe('allow')
    expect(classifyCommand('git status && python deploy.py', cfg())).toBe('ask') // 2ª parte fora
  })
  it('comando fora da allowlist e sem denylist → ask', () => {
    expect(classifyCommand('python build.py', cfg())).toBe('ask')
  })
  it('comando vazio → ask', () => {
    expect(classifyCommand('', cfg())).toBe('ask')
    expect(classifyCommand(undefined, cfg())).toBe('ask')
  })
  it('case-insensitive', () => {
    expect(classifyCommand('RM -RF /', cfg())).toBe('deny')
    expect(classifyCommand('GIT STATUS', cfg())).toBe('allow')
  })
})

describe('DEFAULT_SANDBOX', () => {
  it('vem desligado e com listas razoáveis', () => {
    expect(DEFAULT_SANDBOX.enabled).toBe(false)
    expect(DEFAULT_SANDBOX.denyPatterns).toContain('rm -rf')
    expect(DEFAULT_SANDBOX.allowPrefixes).toContain('git status')
  })
})
