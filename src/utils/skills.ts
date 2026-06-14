// ─── Skills — helpers puros (v2.27.0) ───────────────────────────────
//
// Montagem do manifesto/instruções e lookup. Tudo puro e testável; a UI e o
// useChat só consomem. Ver types/skill.ts para o modelo.

import type { Skill } from '../types/skill'

/** Skills de fábrica — exemplos úteis e editáveis. */
export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'builtin-code-review',
    name: 'code-review',
    description: 'Revisar um diff/código em busca de bugs, segurança e simplificações antes de finalizar.',
    instructions: [
      'Ao revisar código:',
      '1. Procure bugs de correção (off-by-one, null/undefined, condições invertidas, await faltando).',
      '2. Segurança: injeção, segredos hardcoded, validação de entrada, caminhos não sanitizados.',
      '3. Eficiência e reuso: N+1, recomputo desnecessário, código duplicado que já existe no projeto.',
      '4. Para cada achado: arquivo:linha, severidade, e a correção concreta.',
      '5. Termine com um veredito curto: pode mergear? o que bloquear primeiro?',
    ].join('\n'),
    triggers: ['revisar', 'review', 'revisão', 'code review', 'pull request', 'pr '],
    enabled: true,
    pinned: false,
    isBuiltIn: true,
    createdAt: 0,
  },
  {
    id: 'builtin-cite-sources',
    name: 'pesquisa-com-fontes',
    description: 'Pesquisar na web e responder citando as fontes (URLs) usadas.',
    instructions: [
      'Ao pesquisar e responder:',
      '1. Use web_search com consultas específicas; pare assim que tiver o suficiente.',
      '2. Cruze pelo menos duas fontes para fatos importantes.',
      '3. Cite as fontes como links no fim, em "Fontes:".',
      '4. Separe claramente o que é fato verificado do que é inferência sua.',
    ].join('\n'),
    triggers: ['pesquise', 'pesquisar', 'fontes', 'cite', 'busque na web', 'search'],
    enabled: true,
    pinned: false,
    isBuiltIn: true,
    createdAt: 0,
  },
  {
    id: 'builtin-commit-pr',
    name: 'commit-e-pr',
    description: 'Padrão de commit/PR deste projeto (branch, mensagem, rebuild, push).',
    instructions: [
      'Fluxo de entrega deste projeto:',
      '1. Trabalhe na raiz local; crie uma branch por ciclo (cycle/<tema>).',
      '2. Commit com título "vX.Y.Z — descrição"; mensagens em português.',
      '3. Rode os testes e o typecheck antes de finalizar.',
      '4. Reconstrua o instalador em release/ quando aplicável.',
      '5. ff-only na master e git push origin master (toda atualização é enviada).',
    ].join('\n'),
    triggers: ['commit', 'pr', 'release', 'push', 'publicar'],
    enabled: false,
    pinned: false,
    isBuiltIn: true,
    createdAt: 0,
  },
]

/** Lookup por nome (case-insensitive) ou id. Null se não achar. */
export function findSkill(skills: Skill[], nameOrId: string): Skill | null {
  if (!nameOrId) return null
  const q = nameOrId.trim().toLowerCase()
  return skills.find(s => s.name.toLowerCase() === q || s.id.toLowerCase() === q) || null
}

/** Manifesto compacto (nome: descrição) das skills ATIVAS e NÃO fixadas — é o
 *  bloco barato que vai no system prompt instruindo o modelo a chamar
 *  load_skill quando relevante. '' se não houver nenhuma. */
export function renderSkillManifest(skills: Skill[]): string {
  const avail = skills.filter(s => s.enabled && !s.pinned)
  if (avail.length === 0) return ''
  const lines = avail.map(s => `- ${s.name}: ${s.description}`)
  return [
    '[SKILLS DISPONÍVEIS] Quando uma destas capacidades for relevante para a tarefa, chame a ferramenta load_skill("nome") para obter as instruções completas ANTES de prosseguir. Não invente o conteúdo da skill.',
    ...lines,
  ].join('\n')
}

/** Instruções COMPLETAS das skills fixadas (pinned) + ativas — injetadas direto,
 *  sem depender do modelo chamar load_skill. '' se não houver. */
export function renderPinnedSkills(skills: Skill[]): string {
  const pinned = skills.filter(s => s.enabled && s.pinned)
  if (pinned.length === 0) return ''
  return pinned.map(s => `[SKILL ATIVA: ${s.name}]\n${s.instructions}`).join('\n\n')
}

/** Headers curtos para o painel de contexto (orçamento de tokens do slot
 *  "skills"): nome: desc das ativas. */
export function skillManifestHeaders(skills: Skill[]): string {
  return skills.filter(s => s.enabled).map(s => `${s.name}: ${s.description}`).join('\n')
}

/** Skills ATIVAS cujas palavras-gatilho aparecem no texto (Fase 3: auto-sugestão
 *  por palavra-chave). Não inclui as já fixadas (essas já entram inteiras). */
export function matchSkillsByText(skills: Skill[], text: string): Skill[] {
  const t = (text || '').toLowerCase()
  if (!t) return []
  return skills.filter(s =>
    s.enabled && !s.pinned &&
    Array.isArray(s.triggers) &&
    s.triggers.some(k => k && t.includes(k.toLowerCase())),
  )
}

/** Resultado da ferramenta load_skill: as instruções da skill, ou um erro
 *  acionável se o nome não existir. */
export function formatLoadSkillResult(skill: Skill | null, requestedName: string): string {
  if (!skill) {
    return `Erro: skill "${requestedName}" não encontrada. Verifique o nome exato no manifesto [SKILLS DISPONÍVEIS].`
  }
  if (!skill.enabled) {
    return `Erro: a skill "${skill.name}" está desativada.`
  }
  return `[SKILL: ${skill.name}]\n${skill.instructions}`
}

/** Mescla builtins com as skills salvas do usuário: builtins primeiro (com
 *  overrides do usuário aplicados por id), depois as criadas pelo usuário. */
export function mergeSkills(saved: Skill[] | null | undefined): Skill[] {
  const userSkills = Array.isArray(saved) ? saved : []
  const byId = new Map(userSkills.map(s => [s.id, s]))
  const builtins = BUILTIN_SKILLS.map(b => byId.get(b.id) ? { ...b, ...byId.get(b.id)!, isBuiltIn: true } : b)
  const custom = userSkills.filter(s => !BUILTIN_SKILLS.some(b => b.id === s.id))
  return [...builtins, ...custom]
}
