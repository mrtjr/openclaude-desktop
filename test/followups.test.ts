import { describe, it, expect } from 'vitest'
import { parseFollowups, hideFollowupTrailer, followupInstruction, FOLLOWUP_MARKER } from '../src/utils/followups'

describe('parseFollowups', () => {
  it('returns text untouched when there is no marker', () => {
    expect(parseFollowups('apenas uma resposta')).toEqual({ visible: 'apenas uma resposta', followups: [] })
  })

  it('splits the answer from up to 3 follow-up questions', () => {
    const text = `Resposta aqui.\n\n${FOLLOWUP_MARKER}\nComo configuro X?\nE quanto a Y?\nQual o custo?`
    const { visible, followups } = parseFollowups(text)
    expect(visible).toBe('Resposta aqui.')
    expect(followups).toEqual(['Como configuro X?', 'E quanto a Y?', 'Qual o custo?'])
  })

  it('strips bullets, numbering and decorative quotes, caps at 3', () => {
    const text = `R.\n${FOLLOWUP_MARKER}\n- primeira\n2. segunda\n* "terceira"\n- quarta`
    expect(parseFollowups(text).followups).toEqual(['primeira', 'segunda', 'terceira'])
  })

  it('tolerates marker variants (no exact copy) and never leaks it', () => {
    const text = `Texto.\n__ FOLLOW-UPS __\nUma pergunta?`
    const { visible, followups } = parseFollowups(text)
    expect(visible).toBe('Texto.')
    expect(followups).toEqual(['Uma pergunta?'])
    expect(visible).not.toMatch(/follow/i)
  })

  it('strips the marker even when the model emits no questions after it', () => {
    expect(parseFollowups(`Só isso.\n${FOLLOWUP_MARKER}\n`)).toEqual({ visible: 'Só isso.', followups: [] })
  })

  it('uses the LAST marker occurrence', () => {
    const text = `a ${FOLLOWUP_MARKER} b\n${FOLLOWUP_MARKER}\nreal?`
    expect(parseFollowups(text).followups).toEqual(['real?'])
  })
})

describe('hideFollowupTrailer', () => {
  it('hides a complete marker and everything after it', () => {
    expect(hideFollowupTrailer(`Resposta.\n${FOLLOWUP_MARKER}\nq1`)).toBe('Resposta.')
  })

  it('hides a partial marker suffix (>=4 chars) during streaming', () => {
    expect(hideFollowupTrailer('Resposta.\n___FOLLOW')).toBe('Resposta.')
    expect(hideFollowupTrailer('Resposta.\n___FOLLOWUP')).toBe('Resposta.')
  })

  it('does not swallow a short underscore run (markdown ___ )', () => {
    expect(hideFollowupTrailer('ênfase ___')).toBe('ênfase ___')
  })

  it('leaves normal text alone', () => {
    expect(hideFollowupTrailer('texto normal sem marcador')).toBe('texto normal sem marcador')
  })
})

describe('followupInstruction', () => {
  it('mentions the canonical marker in both languages', () => {
    expect(followupInstruction('pt')).toContain(FOLLOWUP_MARKER)
    expect(followupInstruction('en')).toContain(FOLLOWUP_MARKER)
    expect(followupInstruction('pt')).toMatch(/acompanhamento/i)
    expect(followupInstruction('en')).toMatch(/follow-up/i)
  })
})
