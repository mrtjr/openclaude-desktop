// ─── Lifecycle hooks — matcher puro (v2.38.0) ──────────────────────
//
// Inspirado nos hooks do Claude Code: o usuário configura comandos shell que
// rodam em eventos do ciclo de vida. v1 cobre PostToolUse — rodar um comando
// DEPOIS de uma tool executar com sucesso (ex.: `prettier -w .` após edit_file,
// `npm test` após write_file). Mantido puro/testável; a execução fica no
// useToolExecution.

import type { HookDef } from '../settingsConfig'

/** True se o matcher casa com o nome da tool. Regras:
 *   - '' ou '*'            → casa tudo
 *   - termina em '*'       → prefixo (ex.: 'browser_*' casa browser_click)
 *   - senão                → igualdade exata */
export function matchesTool(matcher: string, toolName: string): boolean {
  const m = (matcher || '').trim()
  const n = toolName || ''
  if (!m || m === '*') return true
  if (m.endsWith('*')) return n.startsWith(m.slice(0, -1))
  return m === n
}

/** Hooks ativos para (evento, tool): mesmo evento, com comando, matcher casando. */
export function matchHooks(hooks: HookDef[] | undefined, event: string, toolName: string): HookDef[] {
  if (!Array.isArray(hooks)) return []
  return hooks.filter(h => h && h.event === event && h.command && h.command.trim() && matchesTool(h.matcher, toolName))
}
