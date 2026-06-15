import { describe, it, expect } from 'vitest'
import { SUBAGENT_ROLES, resolveSubagentPrompt, subagentRolesHint } from '../src/constants/subagents'

describe('SUBAGENT_ROLES', () => {
  it('todos têm id, name e description; ids únicos', () => {
    const ids = SUBAGENT_ROLES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of SUBAGENT_ROLES) {
      expect(r.id.length).toBeGreaterThan(0)
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.description.length).toBeGreaterThan(0)
    }
  })
})

describe('resolveSubagentPrompt', () => {
  it('resolve papel conhecido (case-insensitive)', () => {
    expect(resolveSubagentPrompt('explorer')).toContain('EXPLORADOR')
    expect(resolveSubagentPrompt('REVIEWER')).toContain('REVISOR')
  })
  it('papel desconhecido/vazio → string vazia', () => {
    expect(resolveSubagentPrompt('inexistente')).toBe('')
    expect(resolveSubagentPrompt(undefined)).toBe('')
    expect(resolveSubagentPrompt('general')).toBe('') // geral não prepende nada
  })
})

describe('subagentRolesHint', () => {
  it('lista os ids dos papéis', () => {
    const hint = subagentRolesHint()
    expect(hint).toContain('explorer')
    expect(hint).toContain('planner')
    expect(hint).toContain('reviewer')
  })
})
