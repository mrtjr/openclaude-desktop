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
