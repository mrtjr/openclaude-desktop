// ─── Importar SKILL.md (padrão aberto de Agent Skills, v2.150.0) ────
// O SKILL.md (frontmatter YAML com `name`+`description` + corpo markdown) virou
// um PADRÃO cross-tool (Claude Code, Codex, Cursor, Cline…) com 1000+ skills da
// comunidade (anthropics/skills, marketplaces). Nosso tipo Skill já é
// compatível (name/description/instructions/allowed-tools/disallowed-tools), e
// já fazemos progressive disclosure — então basta PARSEAR e importar.
// Núcleo puro e testado.

export interface ParsedSkill {
  name: string
  description: string
  instructions: string
  allowedTools?: string[]
  disallowedTools?: string[]
  triggers?: string[]
}

export interface SkillImportResult {
  skill: ParsedSkill | null
  errors: string[]
  warnings: string[]
}

/** Regras de `name` do padrão: ≤64, minúsculas/números/hífen, sem reservados. */
const RESERVED = new Set(['anthropic', 'claude'])

/** Saneia um nome para o padrão (minúsculas, hífens, sem inválidos). */
export function sanitizeSkillName(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Separa o frontmatter (entre as duas primeiras linhas `---`) do corpo. */
export function splitFrontmatter(md: string): { meta: Record<string, string[] | string>; body: string } {
  const text = String(md || '').replace(/^﻿/, '')
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { meta: {}, body: text.trim() }
  const meta: Record<string, string[] | string> = {}
  const lines = m[1].split(/\r?\n/)
  let curKey: string | null = null
  for (const line of lines) {
    const blockItem = /^\s*-\s+(.*)$/.exec(line)
    if (blockItem && curKey) {
      const arr = Array.isArray(meta[curKey]) ? (meta[curKey] as string[]) : []
      arr.push(stripQuotes(blockItem[1].trim()))
      meta[curKey] = arr
      continue
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    curKey = kv[1].toLowerCase()
    const val = kv[2].trim()
    if (val === '') { meta[curKey] = []; continue } // lista em bloco vem nas próximas linhas
    const inline = /^\[(.*)\]$/.exec(val)
    if (inline) {
      meta[curKey] = inline[1].split(',').map(s => stripQuotes(s.trim())).filter(Boolean)
    } else {
      meta[curKey] = stripQuotes(val)
    }
  }
  return { meta, body: m[2].trim() }
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, '')
}

/** Repos "famosos" da comunidade que de fato contêm SKILL.md (atalhos da UI).
 *  awesome-* são LISTAS (índices), não contêm SKILL.md — por isso ficam de fora. */
export const SKILL_REPO_PRESETS = ['anthropics/skills']

/**
 * Normaliza a entrada de um repo GitHub para { owner, repo, branch? }. Aceita
 * "owner/repo", URL completa, ".git" e ".../tree/branch". Null se inválido.
 * v2.155.0 — instalar skills do GitHub sem git clone.
 */
export function parseRepoSpec(input: string): { owner: string; repo: string; branch?: string } | null {
  let s = String(input || '').trim()
  s = s.replace(/^git@github\.com:/i, '').replace(/^https?:\/\/(www\.)?github\.com\//i, '')
  s = s.replace(/\.git(\/)?$/i, '').replace(/\/+$/, '')
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/([^?#]+))?/.exec(s)
  if (!m) return null
  return { owner: m[1], repo: m[2], ...(m[3] ? { branch: m[3].split('/')[0] } : {}) }
}

/** Primeiro segmento de URLs github.com que NÃO são donos de repositório
 *  (páginas do site). Usado p/ filtrar links no parse de índices. */
const GH_RESERVED_OWNERS = new Set([
  'sponsors', 'topics', 'marketplace', 'apps', 'settings', 'about', 'features',
  'pricing', 'login', 'join', 'search', 'collections', 'orgs', 'users', 'site',
  'contact', 'security', 'explore', 'notifications', 'new', 'organizations',
  'readme', 'watching', 'stars', 'dashboard', 'pulls', 'issues', 'discussions',
])

/**
 * Segue um repositório-ÍNDICE (estilo "awesome-*"): extrai do README os links
 * `github.com/owner/repo` que catalogam OUTROS repositórios de skills. v2.156.0.
 *
 * Repos "awesome-*" não têm SKILL.md próprio — são listas. Esta função
 * transforma o README num conjunto de candidatos (owner/repo) p/ o usuário
 * escolher quais instalar (NÃO baixa nada; puro/testável).
 *
 * - Deduplica (case-insensitive), preserva a 1ª ocorrência.
 * - Ignora subdomínios (gist.github.com, raw.githubusercontent…) via lookbehind.
 * - Ignora páginas do site (github.com/sponsors, /topics, …) e o próprio índice.
 * - Tolera `.git`, querystring/hash/sub-paths (/tree, /blob) e pontuação final.
 */
export function parseSkillIndex(markdown: string, exclude?: { owner: string; repo: string }): { owner: string; repo: string }[] {
  const text = String(markdown || '')
  // Lookbehind exclui subdomínios: em "gist.github.com" o char antes de "github"
  // é "." (bloqueado); em "//github.com" é "/" (permitido).
  const re = /(?<![.\w@])github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi
  const exKey = exclude ? `${exclude.owner}/${exclude.repo}`.toLowerCase() : ''
  const seen = new Set<string>()
  const out: { owner: string; repo: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const owner = m[1]
    const repo = m[2].replace(/\.+$/, '').replace(/\.git$/i, '') // tira ponto final de frase, depois .git
    if (!owner || !repo) continue
    if (GH_RESERVED_OWNERS.has(owner.toLowerCase())) continue
    const key = `${owner}/${repo}`.toLowerCase()
    if (key === exKey || seen.has(key)) continue
    seen.add(key)
    out.push({ owner, repo })
  }
  return out
}

/**
 * Importação em massa: parseia uma lista de arquivos SKILL.md, deduplica por
 * nome (contra os já existentes e entre si) e conta. Tolerante: arquivos
 * inválidos são pulados (não quebram a importação). v2.153.0.
 */
export function buildImportedSkills(
  files: Array<{ path?: string; content: string }>,
  existingNames: string[] = [],
): { skills: ParsedSkill[]; imported: number; invalid: number; duplicates: number } {
  const seen = new Set(existingNames.map(n => sanitizeSkillName(n)).filter(Boolean))
  const skills: ParsedSkill[] = []
  let invalid = 0
  let duplicates = 0
  for (const f of files) {
    const r = parseSkillMarkdown(f?.content || '')
    if (!r.skill) { invalid++; continue }
    const key = sanitizeSkillName(r.skill.name)
    if (!key || seen.has(key)) { duplicates++; continue }
    seen.add(key)
    skills.push(r.skill)
  }
  return { skills, imported: skills.length, invalid, duplicates }
}

// ─── Decisão automática "a IA decide" (v2.157.0) ────────────────────────
// Quando o usuário não diz QUAIS skills quer (no chat), a IA principal decide
// sozinha o que baixar seguindo regras DETERMINÍSTICAS (garantia de "evolução,
// nunca regressão"): se não tem a skill → instala (toda nova é bem-vinda); se
// já tem → só troca pela versão MAIS COMPLETA. Puro/testável.

export interface CompletenessInput {
  description?: string
  instructions?: string
  examples?: string
  triggers?: string[]
  allowedTools?: string[]
}

/** Pontua a "completude" de uma skill. O corpo (instruções) é o sinal dominante;
 *  estrutura (headings/listas), exemplos, descrição, gatilhos e allow-list somam.
 *  Determinístico e monotônico — mais conteúdo/estrutura ⇒ pontuação ≥. */
export function skillCompleteness(s: CompletenessInput): number {
  const desc = String(s?.description || '').trim()
  const body = String(s?.instructions || '').trim()
  let score = 0
  score += Math.min(body.length, 4000) / 100 // corpo: até 40 pts (principal)
  score += Math.min(desc.length, 400) / 50   // descrição: até 8 pts
  // estrutura: headings markdown e itens de lista
  const structure = body.split('\n').filter(l => {
    const t = l.trim()
    return /^#{1,6}\s/.test(t) || /^[-*+]\s/.test(t) || /^\d+\.\s/.test(t)
  }).length
  score += Math.min(structure, 40) * 0.5     // até 20 pts
  if (s?.examples && s.examples.trim()) score += 5
  if (s?.triggers && s.triggers.length) score += 2
  if (s?.allowedTools && s.allowedTools.length) score += 1
  return Math.round(score * 10) / 10
}

export type ImportDecision = 'install' | 'upgrade' | 'skip-regression' | 'skip-equal'

/** Decide o destino de uma skill candidata frente à já instalada (ou null).
 *  install: nova; upgrade: candidata estritamente mais completa (evolução);
 *  skip-regression: candidata menos completa (seria regressão — barrada);
 *  skip-equal: equivalente (sem ganho). `margin` exige uma folga mínima p/ trocar. */
export function decideSkillImport(
  existing: CompletenessInput | null | undefined,
  candidate: CompletenessInput,
  opts: { margin?: number } = {},
): { action: ImportDecision; existingScore: number; candidateScore: number; reason: string } {
  const cand = skillCompleteness(candidate)
  if (!existing) return { action: 'install', existingScore: 0, candidateScore: cand, reason: 'nova skill (ainda não existe) — bem-vinda' }
  const prev = skillCompleteness(existing)
  const margin = Math.max(0, opts.margin ?? 0)
  if (cand > prev + margin) return { action: 'upgrade', existingScore: prev, candidateScore: cand, reason: `mais completa (${cand} > ${prev}) — evolução` }
  if (cand < prev) return { action: 'skip-regression', existingScore: prev, candidateScore: cand, reason: `menos completa (${cand} < ${prev}) — seria regressão` }
  return { action: 'skip-equal', existingScore: prev, candidateScore: cand, reason: `equivalente (${cand} ≈ ${prev}) — sem ganho` }
}

// ─── Lint de qualidade (pesquisa 2026: qualidade/validação de skills) ──
// Checa uma skill contra o padrão SKILL.md + best practices da Anthropic
// (nome ≤64 minúsculas/hífen sem reservados; descrição não-vazia ≤1024 e que
// diga CLARAMENTE quando usar; corpo ≤500 linhas senão dividir via progressive
// disclosure). Útil sobretudo p/ skills importadas da comunidade. Puro/testado.

export interface SkillLike {
  name: string
  description: string
  instructions: string
  pinned?: boolean
  triggers?: string[]
}

export function lintSkill(s: SkillLike): string[] {
  const w: string[] = []
  const name = String(s?.name || '')
  if (!name.trim()) w.push('Sem nome.')
  else {
    if (name.length > 64) w.push('Nome > 64 chars (padrão).')
    if (name !== sanitizeSkillName(name)) w.push('Nome fora do padrão (use minúsculas, números e hífens).')
    if (RESERVED.has(name.toLowerCase())) w.push('Nome reservado (anthropic/claude).')
  }
  const desc = String(s?.description || '')
  if (!desc.trim()) w.push('Sem descrição ("quando usar").')
  else {
    if (desc.length > 1024) w.push('Descrição > 1024 chars (padrão).')
    if (desc.trim().length < 12) w.push('Descrição muito curta — descreva claramente QUANDO usar a skill.')
  }
  const body = String(s?.instructions || '')
  if (!body.trim()) w.push('Sem corpo de instruções.')
  else {
    if (body.trim().length < 40) w.push('Corpo muito curto — uma skill é um playbook acionável, não uma frase; descreva o passo a passo.')
    const lines = body.split('\n').length
    if (lines > 500) w.push(`Corpo com ${lines} linhas (> 500) — divida em arquivos de referência (progressive disclosure).`)
  }
  if (!s?.pinned && !(s?.triggers && s.triggers.length) && desc.trim().length < 30) {
    w.push('Sem gatilhos e descrição fraca — o modelo pode ter dificuldade de descobrir esta skill.')
  }
  return w
}

/** Campos da nossa Skill que viram SKILL.md (subset estável). */
export interface ExportableSkill {
  name: string
  description: string
  instructions: string
  allowedTools?: string[]
  disallowedTools?: string[]
  triggers?: string[]
  examples?: string
}

/** Serializa uma skill no padrão aberto SKILL.md (frontmatter + corpo). Inverso
 *  do parseSkillMarkdown — torna nossas skills portáveis p/ Claude Code/Codex/
 *  Cursor (v2.151.0). */
export function toSkillMarkdown(s: ExportableSkill): string {
  const fm: string[] = ['---']
  fm.push(`name: ${sanitizeSkillName(s.name) || 'skill'}`)
  const desc = String(s.description || '').replace(/\r?\n/g, ' ').slice(0, 1024)
  fm.push(`description: ${desc}`)
  if (s.allowedTools?.length) fm.push(`allowed-tools: [${s.allowedTools.join(', ')}]`)
  if (s.disallowedTools?.length) fm.push(`disallowed-tools: [${s.disallowedTools.join(', ')}]`)
  if (s.triggers?.length) fm.push(`triggers: [${s.triggers.join(', ')}]`)
  fm.push('---')
  let body = String(s.instructions || '').trim()
  if (s.examples && s.examples.trim()) body += `\n\n## Exemplos\n\n${s.examples.trim()}`
  return `${fm.join('\n')}\n\n${body}\n`
}

function asList(v: string[] | string | undefined): string[] | undefined {
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v.filter(Boolean)
  const parts = String(v).split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : undefined
}

/**
 * Parseia um SKILL.md para o nosso formato. É TOLERANTE: saneia o nome e trunca
 * a descrição (com aviso) em vez de rejeitar; só falha sem nome ou sem corpo.
 */
export function parseSkillMarkdown(md: string): SkillImportResult {
  const errors: string[] = []
  const warnings: string[] = []
  const { meta, body } = splitFrontmatter(md)

  const rawName = typeof meta.name === 'string' ? meta.name : ''
  const name = sanitizeSkillName(rawName)
  if (!rawName) errors.push('Frontmatter sem `name`.')
  else if (RESERVED.has(name)) errors.push(`Nome reservado: "${name}".`)
  else if (name !== rawName.toLowerCase().trim()) warnings.push(`Nome ajustado para "${name}" (padrão: minúsculas/hífens).`)

  let description = typeof meta.description === 'string' ? meta.description : ''
  if (!description) errors.push('Frontmatter sem `description`.')
  if (description.length > 1024) { description = description.slice(0, 1024); warnings.push('Descrição truncada em 1024 chars (padrão).') }

  if (!body) errors.push('SKILL.md sem corpo de instruções.')

  if (errors.length) return { skill: null, errors, warnings }

  const allowedTools = asList(meta['allowed-tools'] ?? meta['allowedtools'])
  const disallowedTools = asList(meta['disallowed-tools'] ?? meta['disallowedtools'])
  const triggers = asList(meta['triggers'] ?? meta['keywords'])

  return {
    skill: {
      name, description, instructions: body,
      ...(allowedTools ? { allowedTools } : {}),
      ...(disallowedTools ? { disallowedTools } : {}),
      ...(triggers ? { triggers } : {}),
    },
    errors,
    warnings,
  }
}
