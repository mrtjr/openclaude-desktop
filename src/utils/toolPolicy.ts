// ─── Tool execution policy ──────────────────────────────────────────
//
// The approval gate and the output clamp used to live inline in
// useToolExecution and were untested — yet this is the code that decides
// whether a *dangerous* tool (execute_command, write_file, git_command…)
// runs without asking the user. Extracted here so the security-relevant
// decision is a small pure function with full test coverage.

import { DANGEROUS_TOOLS } from '../constants/tools'
import type { PermissionLevel } from '../settingsConfig'

/** Tools that 'auto_edits' mode lets through without a prompt (the file edits
 *  the user opted to auto-accept). Everything else dangerous still asks. */
export const AUTO_EDIT_TOOLS = new Set(['write_file', 'git_command', 'undo_last_write'])

/** Whether a tool call needs explicit user approval at the given permission
 *  level:
 *   - 'ask' / 'planning' → every dangerous tool asks
 *   - 'auto_edits'       → edit tools run silently; the rest (e.g.
 *                          execute_command) still ask
 *   - 'ignore'           → nothing asks */
export function toolNeedsApproval(level: PermissionLevel, name: string): boolean {
  switch (level) {
    case 'ignore':
      return false
    case 'auto_edits':
      return DANGEROUS_TOOLS.has(name) && !AUTO_EDIT_TOOLS.has(name)
    case 'ask':
    case 'planning':
    default:
      return DANGEROUS_TOOLS.has(name)
  }
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
