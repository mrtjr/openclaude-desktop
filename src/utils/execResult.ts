// ─── execute_command result fidelity — pure helpers ─────────────────
//
// execute_command is the #1 tool in real usage (Dev Insights digest), so the
// agent loop's view of a command's outcome must be HONEST. Before v2.12.47 the
// renderer returned `stdout || stderr || error` — which (a) hid the exit code
// entirely (a failing command that printed to stdout looked like success) and
// (b) dropped stderr whenever stdout existed (warnings vanished). These pure
// helpers fix both, and resolve the effective working directory for the run.

/** Shape returned by the `exec-command` IPC handler (electron/main.js). */
export interface ExecIpcResult {
  stdout?: string | null
  stderr?: string | null
  exitCode?: number | null
  timedOut?: boolean
  error?: string | null
}

/**
 * Render an exec result for the model. Rules:
 *  - stdout always comes first when present.
 *  - stderr is ALWAYS included (labeled) when present — even alongside stdout.
 *  - a non-zero exit code is appended as `[exit code: N]` so the model can
 *    tell failure from success regardless of what was printed.
 *  - a timeout kill is called out explicitly (exec reports no code for it).
 *  - spawn-level errors (e.g. invalid cwd) surface when nothing was printed.
 */
export function formatExecResult(r: ExecIpcResult): string {
  const stdout = (r.stdout || '').replace(/\s+$/, '')
  const stderr = (r.stderr || '').replace(/\s+$/, '')
  const failed = (r.exitCode ?? 0) !== 0 || !!r.timedOut

  const parts: string[] = []
  if (stdout) parts.push(stdout)
  if (stderr) parts.push(`--- stderr ---\n${stderr}`)
  if (r.timedOut) {
    parts.push('[processo encerrado: tempo limite excedido]')
  } else if (failed) {
    parts.push(`[exit code: ${r.exitCode}]`)
  }
  if (!stdout && !stderr && r.error) parts.push(`Erro: ${r.error}`)
  if (parts.length === 0) return 'Comando executado (sem saída)'
  return parts.join('\n')
}

/**
 * Effective working directory for a command: an explicit `cwd` passed by the
 * model wins; otherwise the active project's folder; otherwise undefined
 * (process default). Blank strings count as absent.
 */
export function resolveExecCwd(
  argCwd: unknown,
  projectCwd: string | null | undefined,
): string | undefined {
  const arg = typeof argCwd === 'string' ? argCwd.trim() : ''
  if (arg) return arg
  const proj = (projectCwd || '').trim()
  return proj || undefined
}
