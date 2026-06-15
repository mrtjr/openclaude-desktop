import { describe, it, expect } from 'vitest'
import { matchesTool, matchHooks } from '../src/utils/hooks'
import type { HookDef } from '../src/settingsConfig'

const h = (matcher: string, command = 'echo hi', event: HookDef['event'] = 'PostToolUse'): HookDef => ({ event, matcher, command })

describe('matchesTool', () => {
  it('* e vazio casam tudo', () => {
    expect(matchesTool('*', 'edit_file')).toBe(true)
    expect(matchesTool('', 'edit_file')).toBe(true)
  })
  it('prefixo com *', () => {
    expect(matchesTool('browser_*', 'browser_click')).toBe(true)
    expect(matchesTool('browser_*', 'edit_file')).toBe(false)
  })
  it('igualdade exata', () => {
    expect(matchesTool('edit_file', 'edit_file')).toBe(true)
    expect(matchesTool('edit_file', 'write_file')).toBe(false)
  })
})

describe('matchHooks', () => {
  const hooks = [h('edit_file', 'prettier'), h('write_file', 'lint'), h('*', 'audit'), h('edit_file', '   ')]
  it('filtra por evento + matcher e ignora comando vazio', () => {
    const m = matchHooks(hooks, 'PostToolUse', 'edit_file')
    expect(m.map(x => x.command)).toEqual(['prettier', 'audit'])
  })
  it('outro evento → nada', () => {
    expect(matchHooks(hooks, 'PreToolUse', 'edit_file')).toEqual([])
  })
  it('lida com undefined/null', () => {
    expect(matchHooks(undefined, 'PostToolUse', 'x')).toEqual([])
  })
})
