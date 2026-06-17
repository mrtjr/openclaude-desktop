import { describe, it, expect } from 'vitest'
import {
  findPersona, isClearPersona, buildPersonaRouterHint, formatSetPersonaResult,
  type PersonaLike,
} from '../src/utils/personas'

const personas: PersonaLike[] = [
  { id: 'builtin-sentinela', name: 'Sentinela', emoji: '🛡️', description: 'segurança', systemPrompt: 'Você é Sentinela...' },
  { id: 'builtin-poeta', name: 'Poeta', emoji: '🪶', description: 'escrita criativa', systemPrompt: 'Você é Poeta...' },
]

describe('findPersona', () => {
  it('acha por nome exato, id e prefixo (case/acento-insensitive)', () => {
    expect(findPersona(personas, 'Sentinela')?.id).toBe('builtin-sentinela')
    expect(findPersona(personas, 'builtin-poeta')?.name).toBe('Poeta')
    expect(findPersona(personas, 'sent')?.name).toBe('Sentinela') // prefixo
    expect(findPersona(personas, 'POETA')?.name).toBe('Poeta')
  })
  it('não acha → null; entrada inválida → null', () => {
    expect(findPersona(personas, 'inexistente')).toBeNull()
    expect(findPersona(undefined, 'x')).toBeNull()
    expect(findPersona(personas, '')).toBeNull()
  })
})

describe('isClearPersona', () => {
  it('reconhece palavras de limpar (com/sem acento)', () => {
    for (const w of ['padrão', 'padrao', 'default', 'none', 'nenhuma', 'limpar', 'reset']) {
      expect(isClearPersona(w)).toBe(true)
    }
  })
  it('nome normal não é "clear"', () => {
    expect(isClearPersona('Sentinela')).toBe(false)
  })
})

describe('buildPersonaRouterHint', () => {
  it('lista personas, a ativa e a regra do set_persona', () => {
    const hint = buildPersonaRouterHint(personas, 'Sentinela', 'pt')
    expect(hint).toContain('Sentinela')
    expect(hint).toContain('Poeta')
    expect(hint).toContain('set_persona')
    expect(hint).toContain('Persona ativa: Sentinela')
  })
  it('sem persona ativa → indica assistente padrão', () => {
    expect(buildPersonaRouterHint(personas, null, 'pt')).toContain('Nenhuma persona ativa')
  })
  it('lista vazia → vazio', () => {
    expect(buildPersonaRouterHint([], null, 'pt')).toBe('')
  })
})

describe('formatSetPersonaResult', () => {
  it('persona ativada vs limpa', () => {
    expect(formatSetPersonaResult(personas[0], 'pt')).toContain('Sentinela')
    expect(formatSetPersonaResult(null, 'pt').toLowerCase()).toContain('removida')
    expect(formatSetPersonaResult(null, 'en').toLowerCase()).toContain('cleared')
  })
})
