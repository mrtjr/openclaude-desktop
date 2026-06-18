// ─── Regras de permissão por PARÂMETRO (v2.93.0) ────────────────────
//
// Porta o "Tool(param:value) syntax matches tool input parameters with *
// wildcard" do Claude Code (v2.1.178). Hoje a aprovação olha só o NOME da tool
// (toolPolicy.toolNeedsApproval). Aqui o usuário define regras que olham os
// ARGUMENTOS — ex.: bloquear `execute_command(command:*rm -rf*)`, sempre pedir
// em `write_file(path:*.env*)`, ou liberar `fetch_url(url:*localhost*)`. Glob
// com `*`. Precedência: deny > ask > allow. Tudo puro/testável.

export type RuleEffect = 'deny' | 'ask' | 'allow'

export interface PermissionRule {
  effect: RuleEffect
  /** Glob do nome da tool. `*` casa qualquer tool. */
  tool: string
  /** Nome do argumento a checar (opcional). Sem param → casa qualquer chamada
   *  daquela tool. */
  param?: string
  /** Glob do valor do argumento (opcional). Sem value mas com param → exige só
   *  que o argumento esteja presente/não-vazio. */
  value?: string
}

/** Converte um glob (só `*` é curinga) numa RegExp ancorada, case-insensitive.
 *  `*foo*` casa "foo" em qualquer posição; `*.x.com` casa subdomínios. */
export function globToRegExp(glob: string): RegExp {
  const esc = String(glob ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp('^' + esc + '$', 'i')
}

/** Uma regra casa esta chamada (nome + args)? */
export function ruleMatches(rule: PermissionRule, toolName: string, args: Record<string, any> | null | undefined): boolean {
  if (!rule || !rule.tool) return false
  if (rule.tool !== '*' && !globToRegExp(rule.tool).test(toolName || '')) return false
  if (rule.param) {
    const raw = args ? (args as any)[rule.param] : undefined
    const sv = raw == null ? '' : String(raw)
    if (rule.value) return globToRegExp(rule.value).test(sv)
    return sv.length > 0 // só presença do argumento
  }
  return true
}

/** Resolve o efeito das regras para uma chamada: deny vence ask vence allow.
 *  null = nenhuma regra casou (cai no gate normal por nível). */
export function evaluatePermissionRules(
  rules: PermissionRule[] | undefined,
  toolName: string,
  args: Record<string, any> | null | undefined,
): RuleEffect | null {
  const any = (e: RuleEffect) => (rules || []).some((r) => r && r.effect === e && ruleMatches(r, toolName, args))
  if (any('deny')) return 'deny'
  if (any('ask')) return 'ask'
  if (any('allow')) return 'allow'
  return null
}

const EFFECTS = new Set<RuleEffect>(['deny', 'ask', 'allow'])

/** Parseia UMA linha do editor: "deny execute_command(command:*rm -rf*)" ou
 *  "ask write_file(path:*.env*)" ou "allow fetch_url". Devolve null se inválida. */
export function parsePermissionRule(line: string): PermissionRule | null {
  const t = String(line ?? '').trim()
  if (!t || t.startsWith('#')) return null
  const m = t.match(/^(\w+)\s+([^(\s]+)\s*(?:\(([^:)]+)\s*:\s*(.*?)\s*\))?\s*$/)
  if (!m) return null
  const effect = m[1].toLowerCase() as RuleEffect
  if (!EFFECTS.has(effect)) return null
  const tool = m[2].trim()
  if (!tool) return null
  const rule: PermissionRule = { effect, tool }
  if (m[3]) {
    rule.param = m[3].trim()
    if (m[4] !== undefined && m[4] !== '') rule.value = m[4]
  }
  return rule
}

/** Serializa de volta para a linha do editor. */
export function formatPermissionRule(rule: PermissionRule): string {
  if (!rule?.effect || !rule.tool) return ''
  let s = `${rule.effect} ${rule.tool}`
  if (rule.param) s += `(${rule.param}:${rule.value ?? '*'})`
  return s
}

/** Parseia o texto multilinha do editor numa lista de regras (ignora linhas
 *  inválidas/comentários). */
export function parsePermissionRules(text: string): PermissionRule[] {
  return String(text ?? '').split('\n').map(parsePermissionRule).filter(Boolean) as PermissionRule[]
}

/** Serializa a lista para o editor multilinha. */
export function formatPermissionRules(rules: PermissionRule[] | undefined): string {
  return (rules || []).map(formatPermissionRule).filter(Boolean).join('\n')
}
