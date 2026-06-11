import { describe, it, expect } from 'vitest'
import { AGENT_SYSTEM_PROMPT, PLANNING_MODE_PROMPT, LANGUAGE_RULE } from '../src/constants/prompts'

// The agent system prompt governs HOW the model researches, executes and
// delivers. These structural guards make sure both languages keep the key
// directives (so an accidental edit can't silently gut the agent brain).

describe('AGENT_SYSTEM_PROMPT', () => {
  for (const lang of ['pt', 'en'] as const) {
    describe(lang, () => {
      const p = AGENT_SYSTEM_PROMPT[lang]

      it('exists and is substantial', () => {
        expect(typeof p).toBe('string')
        expect(p.length).toBeGreaterThan(200)
      })

      it('encodes adaptive planning (act direct on simple, plan only complex)', () => {
        expect(p).toMatch(/plan_tasks/)
        expect(p).toMatch(lang === 'pt' ? /Simples/i : /Simple/i)
        expect(p).toMatch(lang === 'pt' ? /Complex/i : /Complex/i)
      })

      it('pushes EFFICIENCY (the point of the v2.12.65 rewrite)', () => {
        expect(p).toMatch(lang === 'pt' ? /EFICIENTE/i : /EFFICIENT/i)
        // and no longer tells the model speed does not matter
        expect(p).not.toMatch(/TEMPO ILIMITADO|UNLIMITED TIME/i)
        expect(p).not.toMatch(/qualidade.*mais importante que velocidade|matters more than speed/i)
      })

      it('keeps the persistence guarantees (do real work, do not stop midway, deliver)', () => {
        expect(p).toMatch(lang === 'pt' ? /N[ÃA]O PARE NO MEIO/i : /DON'T STOP MIDWAY/i)
        expect(p).toMatch(lang === 'pt' ? /ENTREGUE/i : /DELIVER/i)
        expect(p).toMatch(/update_working_memory/)
      })

      it('adds research discipline + verification', () => {
        expect(p).toMatch(lang === 'pt' ? /PESQUISE/i : /RESEARCH/i)
        expect(p).toMatch(lang === 'pt' ? /VERIFIQUE/i : /VERIFY/i)
      })
    })
  }
})

describe('supporting prompts unchanged in shape', () => {
  it('planning mode + language rule still present for both langs', () => {
    expect(PLANNING_MODE_PROMPT.pt).toMatch(/plan_tasks/)
    expect(PLANNING_MODE_PROMPT.en).toMatch(/plan_tasks/)
    expect(LANGUAGE_RULE.pt).toMatch(/portugu/i)
    expect(LANGUAGE_RULE.en).toMatch(/English/i)
  })
})
