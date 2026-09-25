// ─── Bypass de regras de permissão (v2.204.0) ───────────────────────
//
// `globToRegExp` alimenta o portão que DECIDE se uma tool roda. Dois defeitos
// silenciosos: o `*` não cruzava quebra de linha (anulando deny em comando
// multi-linha) e o `?` vazava como quantificador de regex.

import { describe, it, expect } from 'vitest'
import { globToRegExp, evaluatePermissionRules, parsePermissionRule } from '../src/utils/permissionRules'

describe('o curinga precisa cruzar quebra de linha', () => {
  const regra = [parsePermissionRule('deny execute_command(command:*rm -rf*)')!]

  it('deny vale em comando de uma linha', () => {
    expect(evaluatePermissionRules(regra, 'execute_command', { command: 'rm -rf /' })).toBe('deny')
  })

  it('deny NÃO pode ser burlado pondo o comando na segunda linha', () => {
    // Era o bypass: sem a flag `s`, o `.*` parava na \n e a regra não casava.
    expect(evaluatePermissionRules(regra, 'execute_command', { command: 'echo oi\nrm -rf /' })).toBe('deny')
    expect(evaluatePermissionRules(regra, 'execute_command', { command: '#!/bin/sh\ncd /tmp\nrm -rf ~/docs' })).toBe('deny')
  })

  it('o glob cru também casa através de \n', () => {
    expect(globToRegExp('*rm -rf*').test('ls\nrm -rf /')).toBe(true)
    expect(globToRegExp('*.env*').test('a\n.env')).toBe(true)
  })

  it('sem o padrão, continua não casando (não virou catch-all)', () => {
    expect(evaluatePermissionRules(regra, 'execute_command', { command: 'ls -la\npwd' })).toBe(null)
  })
})

describe('só `*` é curinga, como a doc promete', () => {
  it('`?` é literal, não quantificador', () => {
    expect(globToRegExp('file?.txt').test('fil.txt')).toBe(false)   // era true
    expect(globToRegExp('file?.txt').test('file?.txt')).toBe(true)
  })

  it('metacaracteres de regex continuam escapados', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false)
    expect(globToRegExp('a.b').test('a.b')).toBe(true)
    expect(globToRegExp('c++').test('c++')).toBe(true)
  })
})

describe('precedência das regras não regrediu', () => {
  it('deny > ask > allow', () => {
    const rs = ['allow execute_command', 'ask execute_command', 'deny execute_command'].map(l => parsePermissionRule(l)!)
    expect(evaluatePermissionRules(rs, 'execute_command', {})).toBe('deny')
    expect(evaluatePermissionRules(rs.slice(0, 2), 'execute_command', {})).toBe('ask')
    expect(evaluatePermissionRules(rs.slice(0, 1), 'execute_command', {})).toBe('allow')
  })
})
