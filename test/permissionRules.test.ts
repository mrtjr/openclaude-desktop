import { describe, it, expect } from 'vitest'
import {
  globToRegExp, ruleMatches, evaluatePermissionRules,
  parsePermissionRule, formatPermissionRule, parsePermissionRules, formatPermissionRules,
  type PermissionRule,
} from '../src/utils/permissionRules'

describe('globToRegExp', () => {
  it('* casa qualquer trecho, em qualquer posição', () => {
    expect(globToRegExp('*rm -rf*').test('sudo rm -rf /')).toBe(true)
    expect(globToRegExp('*.env*').test('config/.env.local')).toBe(true)
    expect(globToRegExp('*.example.com').test('foo.example.com')).toBe(true)
    expect(globToRegExp('*.example.com').test('evil.com')).toBe(false)
  })
  it('é case-insensitive e ancorado', () => {
    expect(globToRegExp('GIT_*').test('git_push')).toBe(true)
    expect(globToRegExp('abc').test('xabcx')).toBe(false)
  })
})

describe('ruleMatches', () => {
  it('casa por nome com curinga', () => {
    expect(ruleMatches({ effect: 'deny', tool: '*' }, 'execute_command', {})).toBe(true)
    expect(ruleMatches({ effect: 'deny', tool: 'browser_*' }, 'browser_navigate', {})).toBe(true)
    expect(ruleMatches({ effect: 'deny', tool: 'browser_*' }, 'web_search', {})).toBe(false)
  })
  it('casa por valor de argumento (glob)', () => {
    const r: PermissionRule = { effect: 'deny', tool: 'execute_command', param: 'command', value: '*rm -rf*' }
    expect(ruleMatches(r, 'execute_command', { command: 'rm -rf /tmp' })).toBe(true)
    expect(ruleMatches(r, 'execute_command', { command: 'ls' })).toBe(false)
  })
  it('param sem value exige só presença do argumento', () => {
    const r: PermissionRule = { effect: 'ask', tool: 'write_file', param: 'path' }
    expect(ruleMatches(r, 'write_file', { path: 'a.ts' })).toBe(true)
    expect(ruleMatches(r, 'write_file', {})).toBe(false)
  })
})

describe('evaluatePermissionRules — precedência deny > ask > allow', () => {
  const rules: PermissionRule[] = [
    { effect: 'allow', tool: 'execute_command' },
    { effect: 'ask', tool: 'execute_command', param: 'command', value: '*sudo*' },
    { effect: 'deny', tool: 'execute_command', param: 'command', value: '*rm -rf /*' },
  ]
  it('deny vence', () => {
    expect(evaluatePermissionRules(rules, 'execute_command', { command: 'sudo rm -rf /' })).toBe('deny')
  })
  it('ask quando não há deny', () => {
    expect(evaluatePermissionRules(rules, 'execute_command', { command: 'sudo apt update' })).toBe('ask')
  })
  it('allow quando nem deny nem ask', () => {
    expect(evaluatePermissionRules(rules, 'execute_command', { command: 'ls' })).toBe('allow')
  })
  it('null quando nada casa', () => {
    expect(evaluatePermissionRules(rules, 'web_search', { query: 'x' })).toBeNull()
    expect(evaluatePermissionRules([], 'web_search', {})).toBeNull()
  })
})

describe('parse/format round-trip', () => {
  it('parseia efeito tool(param:value)', () => {
    expect(parsePermissionRule('deny execute_command(command:*rm -rf*)')).toEqual({
      effect: 'deny', tool: 'execute_command', param: 'command', value: '*rm -rf*',
    })
  })
  it('parseia regra só com tool', () => {
    expect(parsePermissionRule('allow fetch_url')).toEqual({ effect: 'allow', tool: 'fetch_url' })
  })
  it('ignora comentários, linhas vazias e efeitos inválidos', () => {
    expect(parsePermissionRule('# comentário')).toBeNull()
    expect(parsePermissionRule('   ')).toBeNull()
    expect(parsePermissionRule('block foo(bar:baz)')).toBeNull() // 'block' não é efeito
  })
  it('format espelha o parse (value default * quando ausente)', () => {
    expect(formatPermissionRule({ effect: 'ask', tool: 'write_file', param: 'path' })).toBe('ask write_file(path:*)')
    expect(formatPermissionRule({ effect: 'deny', tool: '*' })).toBe('deny *')
  })
  it('parse/format de lista multilinha', () => {
    const text = 'deny execute_command(command:*rm -rf*)\nallow fetch_url'
    const rules = parsePermissionRules(text)
    expect(rules.length).toBe(2)
    expect(formatPermissionRules(rules)).toBe(text)
  })
})
