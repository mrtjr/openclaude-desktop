import { describe, it, expect } from 'vitest'
import { sanitizeTitle, deriveTitleFromMessage } from '../src/utils/conversationTitle'

describe('sanitizeTitle', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(sanitizeTitle('  Olá   mundo  ')).toBe('Olá mundo')
    expect(sanitizeTitle('linha1\nlinha2')).toBe('linha1 linha2')
    expect(sanitizeTitle('a'.repeat(120)).length).toBe(80)
  })

  it('returns empty for blank input (caller ignores the rename)', () => {
    expect(sanitizeTitle('   ')).toBe('')
    expect(sanitizeTitle('')).toBe('')
  })
})

describe('deriveTitleFromMessage', () => {
  it('uses a short first sentence as-is', () => {
    expect(deriveTitleFromMessage('Como configuro o proxy? E mais coisas aqui.')).toBe('Como configuro o proxy?')
  })

  it('strips markdown markers and code blocks', () => {
    expect(deriveTitleFromMessage('```js\ncode\n```\n# Título **forte**')).toBe('Título forte')
  })

  it('clips long single sentences at a word boundary with an ellipsis', () => {
    const t = deriveTitleFromMessage('palavra '.repeat(20), 48)
    expect(t.endsWith('…')).toBe(true)
    expect(t.length).toBeLessThanOrEqual(49)
    expect(t).not.toMatch(/palavr$/) // não corta no meio da palavra
  })

  it('falls back for empty input', () => {
    expect(deriveTitleFromMessage('')).toBe('Nova conversa')
  })
})
