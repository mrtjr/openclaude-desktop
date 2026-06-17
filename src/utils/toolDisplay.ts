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
  // delegate_subtasks não tem arg primário de string — mostra a contagem de
  // subagentes para o indicador ao vivo não ficar genérico (v2.65.1).
  if (name === 'delegate_subtasks' && Array.isArray(a.subtasks)) {
    const n = a.subtasks.length
    return `${n} subagente${n === 1 ? '' : 's'} pesquisando…`
  }
  let value = ''
  for (const key of PRIMARY_ARG_KEYS) {
    const v = a[key]
    if (typeof v === 'string' && v.trim()) { value = v; break }
  }
  if (!value) return ''
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine
}

// ─── Render do RESULTADO da tool (v2.81.0) ──────────────────────────
//
// Ferramentas cuja saída é PROSA/markdown autoral renderizam como markdown
// (links clicáveis, títulos, listas) em vez de <pre> cru. As de saída LITERAL/
// código (execute_command, read_file, git, project_tree, browser_*) ficam em
// <pre> — onde markdown mancharia logs/código. web_search já era assim; isto
// estende às ferramentas fundidas no chat (rag_search com fontes, compare_models
// com seções por modelo, análises de visão).
const MARKDOWN_RESULT_TOOLS = new Set<string>([
  'web_search', 'rag_search', 'compare_models', 'analyze_image', 'capture_screen',
])

/** A saída desta tool deve ser renderizada como markdown (vs. <pre> literal)? */
export function shouldRenderToolResultAsMarkdown(name: string): boolean {
  return MARKDOWN_RESULT_TOOLS.has(name)
}
