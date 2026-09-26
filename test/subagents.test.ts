import { describe, it, expect } from 'vitest'
import { SUBAGENT_ROLES, resolveSubagentPrompt, autoInferSubagentRole, subagentRolesHint } from '../src/constants/subagents'

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

describe('autoInferSubagentRole & resolveSubagentPrompt', () => {
  it('resolve papel conhecido (case-insensitive)', () => {
    expect(resolveSubagentPrompt('explorer')).toContain('EXPLORADOR')
    expect(resolveSubagentPrompt('REVIEWER')).toContain('REVISOR')
  })

  it('infere papel automaticamente com base na subtarefa quando omitido', () => {
    expect(autoInferSubagentRole('Revisar erro EDatabaseError no arquivo uPix.pas')).toBe('reviewer')
    expect(autoInferSubagentRole('Criar um plano de arquitetura passo a passo')).toBe('planner')
    expect(autoInferSubagentRole('Investigar onde está o arquivo de configuração')).toBe('explorer')
  })

  it('resolveSubagentPrompt usa o fallback do prompt quando agentId for indefinido', () => {
    expect(resolveSubagentPrompt(undefined, 'revisar erro no arquivo')).toContain('REVISOR')
    expect(resolveSubagentPrompt(undefined, 'desenhar o plano de implementação')).toContain('PLANEJADOR')
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
