import { describe, it, expect } from 'vitest'
import { stripForSpeech, speechOutLang } from '../src/utils/speechOut'

describe('speechOutLang', () => {
  it('mapeia o idioma para BCP-47', () => {
    expect(speechOutLang('en')).toBe('en-US')
    expect(speechOutLang('pt')).toBe('pt-BR')
    expect(speechOutLang(undefined)).toBe('pt-BR')
  })
})

describe('stripForSpeech', () => {
  it('remove blocos de código (vira marcador falável)', () => {
    expect(stripForSpeech('antes\n```js\nconst x = 1\n```\ndepois')).toContain('bloco de código')
    expect(stripForSpeech('```js\ncode\n```')).not.toContain('const')
  })

  it('tira marcadores de markdown e code inline', () => {
    expect(stripForSpeech('# Título **forte** e `code`')).toBe('Título forte e code')
  })

  it('links viram o rótulo; imagens somem', () => {
    expect(stripForSpeech('veja [a doc](https://x.com) e ![img](y.png)')).toBe('veja a doc e')
  })

  it('cap de tamanho', () => {
    expect(stripForSpeech('a'.repeat(5000), 4000).length).toBe(4000)
  })
})
