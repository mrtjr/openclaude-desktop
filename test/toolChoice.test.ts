import { describe, it, expect } from 'vitest'
import { toolChoiceParam, resolveTurnToolChoice, nextToolChoiceMode, toolChoiceLabel } from '../src/utils/toolChoice'

describe('toolChoiceParam', () => {
  it('auto → undefined (omite o parâmetro) em qualquer provider', () => {
    for (const p of ['anthropic', 'openai', 'openrouter', 'modal', 'custom', 'ollama']) {
      expect(toolChoiceParam(p, 'auto')).toBeUndefined()
    }
  })

  it('Anthropic usa objetos {type}', () => {
    expect(toolChoiceParam('anthropic', 'require')).toEqual({ type: 'any' })
    expect(toolChoiceParam('anthropic', 'none')).toEqual({ type: 'none' })
  })

  it('OpenAI-compat usa strings', () => {
    for (const p of ['openai', 'openrouter', 'modal', 'custom', 'ollama']) {
      expect(toolChoiceParam(p, 'require')).toBe('required')
      expect(toolChoiceParam(p, 'none')).toBe('none')
    }
  })
})

describe('resolveTurnToolChoice', () => {
  it('"require" só força no 1º passo (step 0); depois vira auto', () => {
    expect(resolveTurnToolChoice('require', 0)).toBe('require')
    expect(resolveTurnToolChoice('require', 1)).toBe('auto')
    expect(resolveTurnToolChoice('require', 5)).toBe('auto')
  })

  it('"none" vale em todos os passos; "auto"/undefined sempre auto', () => {
    expect(resolveTurnToolChoice('none', 0)).toBe('none')
    expect(resolveTurnToolChoice('none', 3)).toBe('none')
    expect(resolveTurnToolChoice('auto', 0)).toBe('auto')
    expect(resolveTurnToolChoice(undefined, 0)).toBe('auto')
  })
})

describe('nextToolChoiceMode — ciclo Auto→Exigir→Nenhuma→Auto', () => {
  it('cicla na ordem certa', () => {
    expect(nextToolChoiceMode(undefined)).toBe('require')
    expect(nextToolChoiceMode('auto')).toBe('require')
    expect(nextToolChoiceMode('require')).toBe('none')
    expect(nextToolChoiceMode('none')).toBe('auto')
  })
})

describe('toolChoiceLabel', () => {
  it('rótulos bilíngues', () => {
    expect(toolChoiceLabel('require', 'pt')).toBe('Exigir')
    expect(toolChoiceLabel('none', 'en')).toBe('No tools')
    expect(toolChoiceLabel('auto', 'pt')).toBe('Auto')
    expect(toolChoiceLabel(undefined, 'en')).toBe('Auto')
  })
})
