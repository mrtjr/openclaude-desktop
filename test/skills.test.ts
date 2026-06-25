import { describe, it, expect } from 'vitest'
import {
  findSkill, renderSkillManifest, renderPinnedSkills, renderSkillBody, scopeSkillsToProject, skillManifestHeaders,
  matchSkillsByText, formatLoadSkillResult, mergeSkills, BUILTIN_SKILLS,
  collectDisallowedTools, collectAllowedTools, activeSkillsForTools, findActiveSkills, renderActiveSkillReminder, suggestSkill,
  renderActiveSkillsFull, scopeToolsForStep,
} from '../src/utils/skills'
import type { Skill } from '../src/types/skill'

const mk = (over: Partial<Skill>): Skill => ({
  id: over.id || 'id-' + (over.name || 'x'), name: 'x', description: 'desc', instructions: 'INSTR',
  triggers: [], enabled: true, pinned: false, createdAt: 0, ...over,
})

describe('findSkill', () => {
  const skills = [mk({ id: 'a1', name: 'code-review' }), mk({ id: 'b2', name: 'pesquisa' })]
  it('acha por nome (case-insensitive) e por id', () => {
    expect(findSkill(skills, 'CODE-REVIEW')?.id).toBe('a1')
    expect(findSkill(skills, 'b2')?.name).toBe('pesquisa')
  })
  it('null quando não acha ou nome vazio', () => {
    expect(findSkill(skills, 'inexistente')).toBeNull()
    expect(findSkill(skills, '')).toBeNull()
  })
})

describe('renderSkillManifest', () => {
  it('lista ativas e NÃO fixadas, com instrução de load_skill', () => {
    const m = renderSkillManifest([
      mk({ name: 'a', description: 'da' }),
      mk({ name: 'b', description: 'db', pinned: true }),   // fixada → fora do manifesto
      mk({ name: 'c', description: 'dc', enabled: false }), // desativada → fora
    ])
    expect(m).toContain('load_skill')
    expect(m).toContain('- a: da')
    expect(m).not.toContain('- b:')
    expect(m).not.toContain('- c:')
  })
  it('vazio quando não há ativas não-fixadas', () => {
    expect(renderSkillManifest([mk({ enabled: false })])).toBe('')
    expect(renderSkillManifest([])).toBe('')
  })
})

describe('renderPinnedSkills', () => {
  it('injeta instruções completas só das fixadas e ativas', () => {
    const out = renderPinnedSkills([
      mk({ name: 'p', instructions: 'CORPO-P', pinned: true }),
      mk({ name: 'q', instructions: 'CORPO-Q', pinned: false }),
      mk({ name: 'r', instructions: 'CORPO-R', pinned: true, enabled: false }),
    ])
    expect(out).toContain('[SKILL ATIVA: p]')
    expect(out).toContain('CORPO-P')
    expect(out).not.toContain('CORPO-Q')
    expect(out).not.toContain('CORPO-R')
  })
})

describe('matchSkillsByText — gatilhos por palavra-chave', () => {
  const skills = [
    mk({ name: 'rev', triggers: ['revisar', 'review'] }),
    mk({ name: 'pin', triggers: ['x'], pinned: true }),     // já fixada → não re-casa
    mk({ name: 'off', triggers: ['revisar'], enabled: false }),
  ]
  it('casa skills ativas não-fixadas cujo gatilho aparece no texto', () => {
    const m = matchSkillsByText(skills, 'preciso revisar este PR')
    expect(m.map(s => s.name)).toEqual(['rev'])
  })
  it('texto vazio ou sem gatilho → nada', () => {
    expect(matchSkillsByText(skills, '')).toEqual([])
    expect(matchSkillsByText(skills, 'nada aqui')).toEqual([])
  })
})

describe('formatLoadSkillResult', () => {
  it('devolve as instruções quando acha', () => {
    const out = formatLoadSkillResult(mk({ name: 'a', instructions: 'FAÇA X' }), 'a')
    expect(out).toContain('[SKILL: a]')
    expect(out).toContain('FAÇA X')
  })
  it('erro acionável quando não acha', () => {
    expect(formatLoadSkillResult(null, 'fantasma')).toMatch(/não encontrada/)
  })
  it('erro quando a skill está desativada', () => {
    expect(formatLoadSkillResult(mk({ name: 'a', enabled: false }), 'a')).toMatch(/desativada/)
  })
})

describe('mergeSkills', () => {
  it('inclui builtins por padrão e aplica overrides do usuário por id', () => {
    const merged = mergeSkills([{ ...BUILTIN_SKILLS[0], enabled: false }])
    const cr = merged.find(s => s.id === BUILTIN_SKILLS[0].id)!
    expect(cr.enabled).toBe(false)       // override aplicado
    expect(cr.isBuiltIn).toBe(true)      // continua builtin
    expect(merged.length).toBe(BUILTIN_SKILLS.length)
  })
  it('mantém skills customizadas do usuário', () => {
    const merged = mergeSkills([mk({ id: 'custom1', name: 'minha' })])
    expect(merged.some(s => s.id === 'custom1')).toBe(true)
    expect(merged.length).toBe(BUILTIN_SKILLS.length + 1)
  })
  it('lida com null/undefined', () => {
    expect(mergeSkills(null).length).toBe(BUILTIN_SKILLS.length)
    expect(mergeSkills(undefined).length).toBe(BUILTIN_SKILLS.length)
  })
})

describe('skillManifestHeaders', () => {
  it('só ativas, no formato nome: desc (para o orçamento de tokens)', () => {
    const h = skillManifestHeaders([mk({ name: 'a', description: 'da' }), mk({ name: 'b', enabled: false })])
    expect(h).toBe('a: da')
  })
})

describe('BUILTIN_SKILLS — sanidade', () => {
  it('todas têm nome, descrição e instruções', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.instructions.length).toBeGreaterThan(0)
      expect(s.isBuiltIn).toBe(true)
    }
  })
  it('nomes e ids são únicos', () => {
    const names = BUILTIN_SKILLS.map(s => s.name)
    const ids = BUILTIN_SKILLS.map(s => s.id)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('skill de pentest existe e exige autorização/escopo antes de testar', () => {
    const pentest = BUILTIN_SKILLS.find(s => s.name === 'pentest')
    expect(pentest).toBeTruthy()
    expect(pentest!.instructions.toLowerCase()).toContain('autorização')
    expect(pentest!.instructions.toLowerCase()).toContain('escopo')
    // o passo 0 (gate de autorização) vem ANTES de qualquer recon/PoC
    expect(pentest!.instructions.indexOf('0.')).toBeLessThan(pentest!.instructions.indexOf('1.'))
  })
})

describe('disallowed-tools (v2.92.0)', () => {
  it('activeSkillsForTools junta fixadas + casadas (sem staging, sem duplicar)', () => {
    const pinnedA = mk({ id: 'p1', pinned: true, disallowedTools: ['browser_navigate'] })
    const matchedB = mk({ id: 'm1', pinned: false, disallowedTools: ['execute_command'] })
    const staging = mk({ id: 's1', pinned: true, status: 'staging', disallowedTools: ['x'] })
    const dup = mk({ id: 'p1', pinned: false })
    const active = activeSkillsForTools([pinnedA, staging], [matchedB, dup])
    expect(active.map(s => s.id).sort()).toEqual(['m1', 'p1'])
  })
  it('collectDisallowedTools faz a união dos nomes, ignorando vazios', () => {
    const set = collectDisallowedTools([
      mk({ disallowedTools: ['browser_navigate', ' ', 'execute_command'] }),
      mk({ disallowedTools: ['execute_command', 'web_search'] }),
      mk({ disallowedTools: undefined }),
    ])
    expect([...set].sort()).toEqual(['browser_navigate', 'execute_command', 'web_search'])
  })
})

describe('skill ATIVA por load_skill (v2.104.0)', () => {
  const skills = [
    mk({ id: 'a', name: 'code', disallowedTools: ['browser_navigate'] }),
    mk({ id: 'b', name: 'pesquisa' }),
    mk({ id: 'c', name: 'off', enabled: false }),
  ]
  it('findActiveSkills resolve nomes na ordem, ignora inexistente/desativada/duplicada', () => {
    const got = findActiveSkills(skills, ['pesquisa', 'code', 'code', 'fantasma', 'off'])
    expect(got.map(s => s.name)).toEqual(['pesquisa', 'code'])
  })
  it('renderActiveSkillReminder cita os nomes (ou vazio se nenhuma)', () => {
    const r = renderActiveSkillReminder(findActiveSkills(skills, ['code']), 'pt')
    expect(r).toContain('SKILL ATIVA')
    expect(r).toContain('code')
    expect(renderActiveSkillReminder([], 'pt')).toBe('')
    expect(renderActiveSkillReminder(findActiveSkills(skills, ['code']), 'en')).toContain('ACTIVE SKILL')
  })
  it('o disallowed-tools de uma skill carregada vira efetivo via collectDisallowedTools', () => {
    const set = collectDisallowedTools(findActiveSkills(skills, ['code']))
    expect([...set]).toEqual(['browser_navigate'])
  })
  it('renderActiveSkillsFull injeta o CORPO completo (não só o nome) e exclui fixadas', () => {
    const out = renderActiveSkillsFull([
      mk({ name: 'code', instructions: 'PASSOS DETALHADOS DA SKILL' }),
      mk({ name: 'pinned-one', pinned: true, instructions: 'NAO DEVE APARECER' }),
      mk({ name: 'off-one', enabled: false, instructions: 'TAMBEM NAO' }),
    ], 'pt')
    expect(out).toContain('SKILLS ATIVAS')
    expect(out).toContain('[SKILL ATIVA: code]')
    expect(out).toContain('PASSOS DETALHADOS DA SKILL') // corpo, não só o nome
    expect(out).not.toContain('NAO DEVE APARECER')      // fixada já entra via renderPinnedSkills
    expect(out).not.toContain('TAMBEM NAO')             // desativada fora
    expect(renderActiveSkillsFull([], 'pt')).toBe('')
    expect(renderActiveSkillsFull([mk({ name: 'c' })], 'en')).toContain('ACTIVE SKILLS')
  })
})

describe('scopeToolsForStep (v2.158.0 — trava dura de ferramentas por passo)', () => {
  const tool = (name: string) => ({ type: 'function', function: { name } })
  const tools = [tool('read_file'), tool('write_file'), tool('browser_navigate'), tool('load_skill')]
  it('allowlist: mantém só as permitidas + load_skill', () => {
    const out = scopeToolsForStep(tools, new Set(['read_file']), new Set())
    expect(out.map(t => t.function.name).sort()).toEqual(['load_skill', 'read_file'])
  })
  it('disallow: remove as bloqueadas mas NUNCA load_skill', () => {
    const out = scopeToolsForStep(tools, new Set(), new Set(['browser_navigate', 'load_skill']))
    expect(out.map(t => t.function.name)).toEqual(['read_file', 'write_file', 'load_skill'])
  })
  it('sem restrição → lista intacta', () => {
    expect(scopeToolsForStep(tools, new Set(), new Set())).toHaveLength(4)
  })
})

describe('findSkill fuzzy + suggestSkill (v2.105.0)', () => {
  const skills = [mk({ id: 'a1', name: 'code-review' }), mk({ id: 'b2', name: 'pesquisa-com-fontes' })]
  it('casa tolerando espaço/hífen/caixa/acento', () => {
    expect(findSkill(skills, 'Code Review')?.id).toBe('a1')
    expect(findSkill(skills, 'CODE_REVIEW')?.id).toBe('a1')
    expect(findSkill(skills, 'pesquisa com fontes')?.id).toBe('b2')
  })
  it('prefixo só casa quando há UM candidato', () => {
    expect(findSkill([mk({ name: 'code' }), mk({ name: 'code-review' })], 'cod')).toBeNull() // ambíguo
    expect(findSkill([mk({ id: 'x', name: 'deploy-prod' })], 'deploy')?.id).toBe('x')
  })
  it('suggestSkill aponta a mais próxima num miss', () => {
    expect(suggestSkill(skills, 'codereview')).toBe('code-review')
    expect(suggestSkill(skills, 'fontes')).toBe('pesquisa-com-fontes')
    expect(suggestSkill(skills, 'zzz')).toBeNull()
  })
  it('formatLoadSkillResult sugere no miss e surfaca tools no sucesso', () => {
    expect(formatLoadSkillResult(null, 'code rev', 'code-review')).toContain('code-review')
    const ok = formatLoadSkillResult(mk({ name: 'x', disallowedTools: ['execute_command'], allowedTools: ['read_file'] }), 'x')
    expect(ok).toContain('permitidas')
    expect(ok).toContain('read_file')
    expect(ok).toContain('BLOQUEADAS')
  })
})

describe('collectAllowedTools (v2.105.0)', () => {
  it('faz a união das allowlists positivas', () => {
    const set = collectAllowedTools([mk({ allowedTools: ['read_file', 'web_search'] }), mk({ allowedTools: ['read_file'] })])
    expect([...set].sort()).toEqual(['read_file', 'web_search'])
  })
  it('vazio quando nenhuma declara', () => {
    expect(collectAllowedTools([mk({})]).size).toBe(0)
  })
})

describe('exemplos/few-shot na skill (v2.106.0)', () => {
  it('renderSkillBody anexa os exemplos quando há', () => {
    expect(renderSkillBody(mk({ instructions: 'FAÇA X', examples: 'ex1' }))).toBe('FAÇA X\n\nEXEMPLOS:\nex1')
    expect(renderSkillBody(mk({ instructions: 'FAÇA X' }))).toBe('FAÇA X')
    expect(renderSkillBody(mk({ instructions: 'FAÇA X', examples: '   ' }))).toBe('FAÇA X')
  })
  it('formatLoadSkillResult inclui os exemplos', () => {
    expect(formatLoadSkillResult(mk({ name: 'a', instructions: 'I', examples: 'EX' }), 'a')).toContain('EXEMPLOS')
  })
  it('renderPinnedSkills inclui os exemplos das fixadas', () => {
    expect(renderPinnedSkills([mk({ name: 'p', pinned: true, instructions: 'I', examples: 'EX' })])).toContain('EXEMPLOS')
  })
})

describe('scopeSkillsToProject (v2.107.0)', () => {
  const skills = [
    mk({ id: 'g', name: 'global' }),
    mk({ id: 'p1', name: 'do-projeto-1', projectId: 'proj1' }),
    mk({ id: 'p2', name: 'do-projeto-2', projectId: 'proj2' }),
  ]
  it('mantém globais + as do projeto ativo, esconde as de outros', () => {
    expect(scopeSkillsToProject(skills, 'proj1').map(s => s.id).sort()).toEqual(['g', 'p1'])
    expect(scopeSkillsToProject(skills, 'proj2').map(s => s.id).sort()).toEqual(['g', 'p2'])
  })
  it('sem projeto ativo → só as globais', () => {
    expect(scopeSkillsToProject(skills, undefined).map(s => s.id)).toEqual(['g'])
  })
})
