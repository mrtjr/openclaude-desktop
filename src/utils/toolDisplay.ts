// ─── Tool-call display helpers ──────────────────────────────────────
//
// One-line summary of a tool call's primary argument, shared by the live
// "executando…" status (useChat → App) and the tool-call header in
// ChatMessage. Before this, a session with 10+ execute_commands rendered ten
// identical "execute_command" rows and the user had to expand each one to
// know which command ran.

/** Argument keys tried in order — the first string value wins. Covers every
 *  built-in tool's primary arg (command/url/path/query/target/goal/selector). */
const PRIMARY_ARG_KEYS = ['command', 'url', 'path', 'query', 'target', 'goal', 'selector', 'text'] as const

/** Short, single-line summary of a tool call's main argument ('' when there is
 *  nothing presentable). Whitespace collapses so multiline commands stay on
 *  one line; long values get an ellipsis at `max` chars. */
export function toolCallSummary(
  name: string,
  args: Record<string, unknown> | null | undefined,
  max = 60,
): string {
  const a = args || {}
  let value = ''
  for (const key of PRIMARY_ARG_KEYS) {
    const v = a[key]
    if (typeof v === 'string' && v.trim()) { value = v; break }
  }
  if (!value) return ''
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine
}
