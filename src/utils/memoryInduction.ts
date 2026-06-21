// ─── Indução de skills de domínio (Fase 3, v2.54.0) ────────────────
//
// Objetivo (2) do plano: conhecimento recorrente de um DOMÍNIO (ex.: "melhor
// caminho para pentest em otserv") vira uma SKILL aprendida, carregada sob
// demanda por gatilho — em vez de ficar como fatos soltos. Aqui clusterizamos
// os fatos persistidos (bucket `facts`, alimentado pelo remember_fact) por um
// termo de domínio RECORRENTE e rascunhamos uma Skill.
//
// GUARDA-RAILS (centrais para "memória errada se auto-propagando"):
//  - Toda skill induzida nasce status:'staging', enabled:false → NUNCA entra no
//    manifesto nem dispara, até aprovação 1-clique (Fase 4).
//  - Sanitização: remove zero-width/controle e DESCARTA fatos perigosos
//    (execute_command/browser_*/rm -rf/curl|sh) — skill aprendida não carrega
//    instrução de executar nada.
//  - Idempotente: não recria uma skill 'learned-<domínio>' que já existe.
//  - Gate: só rascunha quando o termo recorre em ≥ MIN_FACTS fatos.
//
// Puro/determinístico (recebe `now`); a I/O fica no hook useSkillInduction.

import type { Skill } from '../types/skill'
import { factsContradict } from '../services/memoryDreaming'

export const MIN_FACTS = 3            // recorrência mínima de um domínio
export const MIN_KEYWORD_LEN = 4
const MAX_TAGS = 6
const MAX_BODY_FACTS = 20

const STOPWORDS = new Set([
  // PT
  'para', 'com', 'que', 'uma', 'dos', 'das', 'por', 'como', 'mais', 'isso', 'este', 'esta', 'esse', 'essa', 'sua', 'seu', 'sao', 'nao', 'sim', 'tem', 'foi', 'ser', 'esta', 'pelo', 'pela', 'aos', 'nas', 'nos', 'sobre', 'quando', 'onde', 'qual', 'cada', 'tambem', 'muito', 'pode', 'deve', 'fazer', 'usar', 'tipo', 'sempre', 'entre',
  // EN
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was', 'are', 'not', 'you', 'your', 'can', 'should', 'when', 'where', 'which', 'each', 'also', 'very', 'use', 'using', 'about', 'into', 'then', 'than', 'they', 'them', 'its',
])

// v2.115.0 — endurecido: variações de espaço/underscore em "execute command",
// mais tools de risco, e expansão de shell/PS.
const DANGEROUS = /\b(execute[\s_]*command|run_command_background|git_worktree|browser_\w+|computer_\w+|rm\s+-rf|del\s+\/|format\s+c:|curl[^\n|]*\|\s*(sh|bash)|wget[^\n|]*\|\s*(sh|bash)|invoke-expression|iex\s)\b/i
// v2.115.0 — frases de PROMPT-INJECTION que jamais devem virar fato/preferência
// injetada no system prompt ("ignore as instruções anteriores", "system prompt"…).
const INJECTION = /\b(ignore|disregard|forget|override|esque[çc]a)\b[\s\S]{0,40}(instru|regras?|\brules?\b|system\s*prompt|prompt do sistema)/i

/** Tokens significativos de um texto (minúsculos, sem stopwords/números). */
export function keywordsOf(text: string): string[] {
  const toks = String(text || '').toLowerCase().match(/[a-zà-ÿ0-9_-]+/gi) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const tRaw of toks) {
    const t = tRaw.replace(/^[-_]+|[-_]+$/g, '')
    if (t.length < MIN_KEYWORD_LEN) continue
    if (STOPWORDS.has(t)) continue
    if (/^\d+$/.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** Slug seguro para id/name de skill (só [a-z0-9-]). */
export function slugifyDomain(s: string): string {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dominio'
}

/** Remove caracteres invisíveis/controle e colapsa espaço (anti-injeção). */
export function sanitizeFact(text: string): string {
  let out = ''
  for (const ch of String(text || '')) {
    const c = ch.codePointAt(0) || 0
    // pula controle, zero-width, bidi-override, word-joiner e BOM (anti-injecao)
    if (c < 0x20 || c === 0x7f || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || c === 0x2060 || c === 0xfeff) continue
    out += ch
  }
  return out.replace(/[ \t]+/g, ' ').trim()
}

/** True se o fato pede execução de comando/navegador, traz frase de injeção, ou
 *  contém expansão de shell/PS — não entra em skill aprendida nem em preferência. */
export function isDangerousFact(text: string): boolean {
  const s = String(text || '')
  return DANGEROUS.test(s) || INJECTION.test(s) || /\$\(|\$\{/.test(s)
}

/**
 * Induz rascunhos de skill de domínio a partir dos fatos persistidos.
 * Cada termo significativo que recorre em ≥ MIN_FACTS fatos (e ainda não tem
 * skill 'learned-<slug>') vira um rascunho em staging. Processa por recorrência
 * decrescente e evita domínios sobrepostos (subconjunto de outro já feito).
 */
export function induceLearnedSkills(
  facts: string[],
  existingSkills: Skill[],
  opts: { now?: number; minFacts?: number } = {},
): Skill[] {
  const now = opts.now ?? 0
  const minFacts = opts.minFacts ?? MIN_FACTS

  // Sanitiza e descarta fatos perigosos ANTES de qualquer clustering.
  const clean = cleanFacts(facts)
  if (clean.length < minFacts) return []

  // keyword → índices dos fatos que a contêm
  const kwToFacts = new Map<string, number[]>()
  clean.forEach((f, i) => {
    for (const k of keywordsOf(f)) {
      const arr = kwToFacts.get(k) || []
      arr.push(i)
      kwToFacts.set(k, arr)
    }
  })

  const existingIds = new Set(existingSkills.map(s => s.id))
  // termos recorrentes, do mais frequente ao menos
  const domains = [...kwToFacts.entries()]
    .filter(([, idxs]) => idxs.length >= minFacts)
    .sort((a, b) => b[1].length - a[1].length)

  const drafts: Skill[] = []
  const usedFactIdx = new Set<number>()

  for (const [term, idxs] of domains) {
    const id = `learned-${slugifyDomain(term)}`
    if (existingIds.has(id) || drafts.some(d => d.id === id)) continue
    // pula domínio cujos fatos já foram majoritariamente cobertos por outro draft
    const fresh = idxs.filter(i => !usedFactIdx.has(i))
    if (fresh.length < minFacts) continue

    const clusterFacts = fresh.slice(0, MAX_BODY_FACTS).map(i => clean[i])
    // tags = co-ocorrências mais comuns nos fatos do cluster
    const tagCount = new Map<string, number>()
    for (const i of fresh) for (const k of keywordsOf(clean[i])) tagCount.set(k, (tagCount.get(k) || 0) + 1)
    const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS).map(([k]) => k)

    const instructions = [
      `Conhecimento aprendido sobre "${term}" (rascunho induzido automaticamente — revise antes de confiar):`,
      ...clusterFacts.map(f => `- ${f}`),
    ].join('\n')

    drafts.push({
      id,
      name: slugifyDomain(term),
      description: `Conhecimento de domínio sobre ${term} (aprendido; revisar)`,
      instructions,
      triggers: tags,
      enabled: false,
      pinned: false,
      kind: 'learned',
      status: 'staging',
      provenance: { sourceConvIds: [], confidence: Math.min(1, fresh.length / 5) },
      createdAt: now,
    })
    fresh.forEach(i => usedFactIdx.add(i))
  }

  return drafts
}

/** Sanitiza e remove fatos perigosos (compartilhado por induce/reconcile). */
function cleanFacts(facts: string[]): string[] {
  return (facts || []).map(sanitizeFact).filter(f => f && !isDangerousFact(f))
}

const BULLET = '- '

function parseBody(instructions: string): { header: string; bullets: string[] } {
  const lines = String(instructions || '').split('\n')
  const header = lines.length && !lines[0].startsWith(BULLET) ? lines[0] : ''
  const bullets = lines.filter(l => l.startsWith(BULLET)).map(l => l.slice(BULLET.length).trim()).filter(Boolean)
  return { header, bullets }
}

/** Dois textos falam do mesmo "tópico" se compartilham ≥2 keywords. */
function sameTopic(a: string, b: string): boolean {
  const ka = new Set(keywordsOf(a))
  let shared = 0
  for (const k of keywordsOf(b)) if (ka.has(k)) shared++
  return shared >= 2
}

const normLine = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * DELTA-update (Fase 4): atualiza o CORPO de uma skill aprendida com fatos novos
 * do mesmo domínio — em bullets, NUNCA reescrevendo o corpo inteiro (ACE prova
 * que rewrite causa context-collapse). Por fato: duplicado → NOOP; contradiz um
 * bullet do mesmo tópico → UPDATE (substitui); novo → ADD. Retorna a skill
 * atualizada, ou null se nada mudou. Preserva status/enabled (não reativa nada).
 */
export function reconcileLearnedSkill(
  skill: Skill,
  newFacts: string[],
  opts: { now?: number } = {},
): Skill | null {
  const incoming = cleanFacts(newFacts)
  if (!incoming.length) return null
  const { header, bullets } = parseBody(skill.instructions)
  const have = new Set(bullets.map(normLine))
  let next = [...bullets]
  let changed = false

  for (const f of incoming) {
    if (have.has(normLine(f))) continue // NOOP: já consta
    const ci = next.findIndex(b => sameTopic(b, f) && factsContradict(b, f))
    if (ci >= 0) { next[ci] = f; have.add(normLine(f)); changed = true; continue } // UPDATE
    next.push(f); have.add(normLine(f)); changed = true                            // ADD
  }
  if (!changed) return null
  if (next.length > MAX_BODY_FACTS) next = next.slice(next.length - MAX_BODY_FACTS)

  const head = header || `Conhecimento aprendido sobre "${skill.name}" (revise antes de confiar):`
  const instructions = [head, ...next.map(b => `${BULLET}${b}`)].join('\n')
  const confidence = Math.min(1, (skill.provenance?.confidence ?? 0.5) + 0.05)
  return {
    ...skill,
    instructions,
    provenance: { sourceConvIds: skill.provenance?.sourceConvIds || [], confidence },
    createdAt: skill.createdAt || (opts.now ?? 0),
  }
}

/**
 * Induz rascunhos para domínios novos E reconcilia (delta-update) as skills
 * aprendidas já existentes com fatos novos do mesmo domínio (objetivo 3:
 * auto-atualização). Retorna { drafts, updates } para o hook aplicar.
 */
export function induceAndReconcile(
  facts: string[],
  existingSkills: Skill[],
  opts: { now?: number; minFacts?: number } = {},
): { drafts: Skill[]; updates: Skill[] } {
  const drafts = induceLearnedSkills(facts, existingSkills, opts)
  const clean = cleanFacts(facts)
  const updates: Skill[] = []
  for (const sk of existingSkills) {
    if (sk.kind !== 'learned') continue
    const term = (sk.name || '').toLowerCase()
    if (!term) continue
    const domainFacts = clean.filter(f => keywordsOf(f).includes(term))
    if (!domainFacts.length) continue
    const upd = reconcileLearnedSkill(sk, domainFacts, opts)
    if (upd) updates.push(upd)
  }
  return { drafts, updates }
}
