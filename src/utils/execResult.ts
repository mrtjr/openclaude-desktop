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
  /** The command was tree-killed because the user pressed Stop (not a timeout
   *  and not a normal exit). */
  killedByUser?: boolean
  /** Effective timeout the handler applied — echoed back so the timeout
   *  message can tell the model whether asking for more time is an option. */
  timeoutMs?: number
  error?: string | null
}

// Timeout bounds for execute_command. The old fixed 60s wall made whole task
// classes (builds, installs, backtests) impossible for the agent — the model
// can now request up to 10 minutes per command via the `timeout_s` tool arg.
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000
export const MIN_EXEC_TIMEOUT_MS = 1_000
export const MAX_EXEC_TIMEOUT_MS = 600_000

/** Resolve the model-supplied `timeout_s` (seconds) into clamped milliseconds.
 *  Absent/invalid/non-positive values fall back to the 60s default. */
export function resolveExecTimeoutMs(argTimeoutS: unknown): number {
  const n = Number(argTimeoutS)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EXEC_TIMEOUT_MS
  return Math.min(Math.max(Math.round(n * 1000), MIN_EXEC_TIMEOUT_MS), MAX_EXEC_TIMEOUT_MS)
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
  if (r.killedByUser) {
    parts.push('[comando interrompido pelo usuário]')
  } else if (r.timedOut) {
    // The marker line must stay byte-identical — circuitBreaker's
    // EXEC_FAILURE_MARKER matches it line-anchored. The remedy hint goes on
    // its own line so the model knows MORE TIME is requestable (and stays
    // quiet when the command already ran at the cap).
    parts.push('[processo encerrado: tempo limite excedido]')
    const used = r.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS
    if (used < MAX_EXEC_TIMEOUT_MS) {
      parts.push(`Dica: o comando excedeu ${Math.round(used / 1000)}s — chame de novo com timeout_s maior (máximo ${MAX_EXEC_TIMEOUT_MS / 1000}s).`)
    }
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
