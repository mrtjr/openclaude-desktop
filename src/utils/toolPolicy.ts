// ─── Tool execution policy ──────────────────────────────────────────
//
// The approval gate and the output clamp used to live inline in
// useToolExecution and were untested — yet this is the code that decides
// whether a *dangerous* tool (execute_command, write_file, git_command…)
// runs without asking the user. Extracted here so the security-relevant
// decision is a small pure function with full test coverage.

import { DANGEROUS_TOOLS } from '../constants/tools'
import { EXEC_FAILURE_MARKER } from './circuitBreaker'
import type { PermissionLevel } from '../settingsConfig'

/** Tools that 'auto_edits' mode lets through without a prompt (the file edits
 *  the user opted to auto-accept). Everything else dangerous still asks. */
export const AUTO_EDIT_TOOLS = new Set(['write_file', 'edit_file', 'git_command', 'undo_last_write'])

/** Whether a tool call needs explicit user approval at the given permission
 *  level:
 *   - 'ask' / 'planning' → every dangerous tool asks
 *   - 'auto_edits'       → edit tools run silently; the rest (e.g.
 *                          execute_command) still ask
 *   - 'ignore'           → nothing asks */
export function toolNeedsApproval(level: PermissionLevel, name: string): boolean {
  // Tools de servidores MCP (mcp__*) são externas e podem fazer qualquer coisa
  // (ler/escrever arquivos, rede) — tratadas como perigosas por padrão, como o
  // Claude faz ao pedir permissão para tools MCP (v2.35.0).
  const isDangerous = DANGEROUS_TOOLS.has(name) || name.startsWith('mcp__')
  switch (level) {
    case 'ignore':
      return false
    case 'auto_edits':
      return isDangerous && !AUTO_EDIT_TOOLS.has(name)
    case 'ask':
    case 'planning':
    default:
      return isDangerous
  }
}

/** Classify a tool's textual output as an error, for the audit log and the
 *  Dev Insights telemetry. The old inline check only caught `Erro:` and
 *  `[SYSTEM INTERCEPT]` — so `Git error:`, `Browser launch error:`, failed
 *  commands etc. were all recorded as SUCCESS, and the digest that drives
 *  each improvement cycle overstated tool reliability. Covers:
 *   - the labeled prefixes used across useToolExecution (`Erro:`, `Error:`,
 *     and any `<words> error:` form, so future tools get caught too);
 *   - `[SYSTEM INTERCEPT]` guards;
 *   - execute_command failures via the line-anchored exit-code/timeout
 *     markers (scoped to that tool — other tools may echo similar text). */
export function isToolError(output: string, toolName?: string): boolean {
  const out = output || ''
  // Prefixos de falha — inclui os PT usados pelas tools fundidas (glob_files,
  // background commands): "Não consegui …" e "Falha/Falhou/Falhei …" eram
  // logados como SUCESSO no relatório .md e no Dev Insights. NÃO inclui
  // "Nenhum …"/"Nada encontrado …" de propósito: são no-match legítimos, não erro.
  if (/^(Erro\b|Error:|Falh[aeio]|Não consegui|\[SYSTEM INTERCEPT\])/.test(out)) return true
  if (/^[A-Za-z][A-Za-z ]{0,30} error:/.test(out)) return true
  if (toolName === 'execute_command' && EXEC_FAILURE_MARKER.test(out)) return true
  return false
}

export const TOOL_OUTPUT_LIMIT = 4000

/** Clamp an over-long tool result so a giant output can't blow the model's
 *  context: keep the head and tail with a truncation marker between them.
 *  Outputs at or under the limit pass through unchanged. */
export function truncateToolOutput(out: string, limit = TOOL_OUTPUT_LIMIT): string {
  if (!out || out.length <= limit) return out
  return (
    out.substring(0, 2000) +
    `\n\n...[SYSTEM TRUNCATED: Output too large. Original size was ${out.length} characters. Showing start and end only.]...\n\n` +
    out.substring(out.length - 1500)
  )
}
