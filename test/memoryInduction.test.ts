import { describe, it, expect } from 'vitest'
import {
  induceLearnedSkills, induceAndReconcile, reconcileLearnedSkill,
  keywordsOf, slugifyDomain, sanitizeFact, isDangerousFact,
} from '../src/utils/memoryInduction'
import type { Skill } from '../src/types/skill'

const learnedOtserv = (): Skill => ({
  id: 'learned-otserv', name: 'otserv', description: 'dominio otserv',
  instructions: 'Conhecimento aprendido sobre "otserv":\n- otserv usa a porta 7171 para login\n- otserv roda no protocolo do tibia',
  triggers: ['otserv'], enabled: true, pinned: false, kind: 'learned', status: 'active',
  provenance: { sourceConvIds: [], confidence: 0.6 }, createdAt: 0,
})

const otservFacts = [
  'no pentest de otserv a porta de login costuma ser a 7171',
  'otserv roda no protocolo do tibia versao 8.60',
  'para auditar otserv comece pelos assets do client web',
]

describe('keywordsOf / slugifyDomain / sanitizeFact', () => {
  it('keywordsOf descarta stopwords, números e tokens curtos', () => {
    const k = keywordsOf('para o otserv usar a porta 7171')
    expect(k).toContain('otserv')
    expect(k).toContain('porta')
    expect(k).not.toContain('para')
    expect(k).not.toContain('7171')
  })
  it('slugifyDomain produz [a-z0-9-]', () => {
    expect(slugifyDomain('Pentest OTServ!')).toBe('pentest-otserv')
  })
  it('isDangerousFact pega comandos/navegador', () => {
    expect(isDangerousFact('rode execute_command rm -rf /')).toBe(true)
    expect(isDangerousFact('use browser_click no botão')).toBe(true)
    expect(isDangerousFact('otserv usa a porta 7171')).toBe(false)
  })
})

describe('induceLearnedSkills', () => {
  it('rascunha 1 skill staging para domínio recorrente (otserv)', () => {
    const drafts = induceLearnedSkills(otservFacts, [], { now: 123 })
    expect(drafts.length).toBe(1)
    const s = drafts[0]
    expect(s.id).toBe('learned-otserv')
    expect(s.kind).toBe('learned')
    expect(s.status).toBe('staging')
    expect(s.enabled).toBe(false)            // nunca entra no manifesto sem aprovação
    expect(s.triggers).toContain('otserv')
    expect(s.instructions).toContain('otserv')
    expect(s.createdAt).toBe(123)
  })
  it('nada recorrente → nenhum rascunho', () => {
    expect(induceLearnedSkills(['fato isolado um', 'outro tema aleatorio', 'terceiro assunto'], [])).toEqual([])
  })
  it('é idempotente: não recria skill learned já existente', () => {
    const existing: Skill[] = [{ id: 'learned-otserv', name: 'otserv', description: '', instructions: '', enabled: false, pinned: false, createdAt: 0 }]
    expect(induceLearnedSkills(otservFacts, existing)).toEqual([])
  })
  it('descarta fatos perigosos do corpo (não instrui executar nada)', () => {
    const withDanger = [...otservFacts, 'para escanear otserv rode execute_command nmap']
    const drafts = induceLearnedSkills(withDanger, [], { now: 1 })
    expect(drafts.length).toBe(1)
    expect(drafts[0].instructions).not.toContain('execute_command')
  })
  it('respeita minFacts (gate de recorrência)', () => {
    expect(induceLearnedSkills(otservFacts.slice(0, 2), [], { minFacts: 3 })).toEqual([])
  })
})

describe('reconcileLearnedSkill (delta-update, Fase 4)', () => {
  it('ADD: fato novo do domínio é anexado como bullet, preservando status/enabled', () => {
    const upd = reconcileLearnedSkill(learnedOtserv(), ['otserv tem um painel admin oculto no client'])
    expect(upd).not.toBeNull()
    expect(upd!.instructions).toContain('painel admin oculto')
    expect(upd!.status).toBe('active')
    expect(upd!.enabled).toBe(true)
    expect(upd!.provenance!.confidence).toBeGreaterThan(0.6) // reforço sobe confiança
  })
  it('NOOP: fato duplicado não muda nada (retorna null)', () => {
    expect(reconcileLearnedSkill(learnedOtserv(), ['otserv usa a porta 7171 para login'])).toBeNull()
  })
  it('UPDATE: fato que contradiz substitui o bullet (não empilha)', () => {
    const upd = reconcileLearnedSkill(learnedOtserv(), ['otserv nao usa a porta 7171 para login'])
    expect(upd).not.toBeNull()
    const bullets = upd!.instructions.split('\n').filter(l => l.startsWith('- '))
    expect(bullets.length).toBe(2)                                  // substituiu, não duplicou
    expect(upd!.instructions).toContain('nao usa a porta 7171')
  })
})

describe('induceAndReconcile (Fase 4)', () => {
  it('domínio novo → draft; nenhuma skill existente → 0 updates', () => {
    const { drafts, updates } = induceAndReconcile(otservFacts, [], { now: 1 })
    expect(drafts.length).toBe(1)
    expect(updates.length).toBe(0)
  })
  it('skill learned existente + fato novo do domínio → update (delta), sem novo draft', () => {
    const facts = ['otserv tem painel admin novo aqui', 'otserv usa a porta 7171 para login', 'otserv roda no protocolo do tibia']
    const { drafts, updates } = induceAndReconcile(facts, [learnedOtserv()], { now: 1 })
    expect(drafts.length).toBe(0)               // 'otserv' já existe → não recria
    expect(updates.length).toBe(1)
    expect(updates[0].instructions).toContain('painel admin novo')
  })
})
