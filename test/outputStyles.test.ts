import { describe, it, expect } from 'vitest'
import { OUTPUT_STYLES, outputStyleAddition } from '../src/constants/outputStyles'

describe('outputStyleAddition', () => {
  it('default e id desconhecido → string vazia (sem efeito)', () => {
    expect(outputStyleAddition('default', 'pt')).toBe('')
    expect(outputStyleAddition('inexistente', 'pt')).toBe('')
    expect(outputStyleAddition(undefined, 'pt')).toBe('')
  })
  it('devolve a instrução PT/EN do estilo', () => {
    expect(outputStyleAddition('concise', 'pt')).toContain('direto')
    expect(outputStyleAddition('concise', 'en')).toContain('direct')
    expect(outputStyleAddition('code', 'pt')).toContain('CÓDIGO')
    expect(outputStyleAddition('learning', 'en')).toContain('mentor')
  })
})

describe('OUTPUT_STYLES — sanidade', () => {
  it('tem o estilo padrão vazio e ids únicos', () => {
    const def = OUTPUT_STYLES.find(s => s.id === 'default')
    expect(def?.prompt).toBe('')
    const ids = OUTPUT_STYLES.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('todo estilo não-default tem prompt PT e EN', () => {
    for (const s of OUTPUT_STYLES.filter(s => s.id !== 'default')) {
      expect(s.prompt.length).toBeGreaterThan(0)
      expect(s.promptEn.length).toBeGreaterThan(0)
    }
  })
})
