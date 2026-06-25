import { describe, it, expect } from 'vitest'
import { buildEvolvePrompt, parseEvolvedSkill } from '../src/utils/skillEvolution'

describe('buildEvolvePrompt', () => {
  it('mantém nome/escopo e pede o formato marcado (PT/EN)', () => {
    const pt = buildEvolvePrompt({ name: 'code-review', description: 'd', instructions: 'i', usageCount: 7 }, 'pt')
    expect(pt).toContain('code-review')
    expect(pt).toMatch(/SEM mudar o escopo nem o nome/i)
    expect(pt).toContain('___INSTRUCTIONS___')
    expect(pt).toMatch(/usada ~7 vezes/i)
    const en = buildEvolvePrompt({ name: 'x', description: 'd', instructions: 'i' }, 'en')
    expect(en).toMatch(/WITHOUT changing its scope or name/i)
  })
})

describe('parseEvolvedSkill', () => {
  it('extrai descrição, instruções e exemplos das seções marcadas', () => {
    const out = parseEvolvedSkill([
      '___DESCRIPTION___', 'Use ao revisar PRs',
      '___INSTRUCTIONS___', 'Passo 1.\nPasso 2.',
      '___EXAMPLES___', 'ex: foo',
    ].join('\n'))
    expect(out).toEqual({ description: 'Use ao revisar PRs', instructions: 'Passo 1.\nPasso 2.', examples: 'ex: foo' })
  })

  it('funciona sem exemplos e limpa "(opcional)"/aspas', () => {
    expect(parseEvolvedSkill('___DESCRIPTION___\nd\n___INSTRUCTIONS___\ncorpo')).toEqual({ description: 'd', instructions: 'corpo' })
  })

  it('null quando não há instruções', () => {
    expect(parseEvolvedSkill('blá blá sem marcadores')).toBeNull()
    expect(parseEvolvedSkill('___DESCRIPTION___\nsó descrição')).toBeNull()
  })
})
