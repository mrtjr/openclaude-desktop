// ─── Tool Deferral ─────────────────────────────────────────────────
//
// Claude-Code-style deferred tool loading. Tools marked as deferred
// are NOT injected with full JSONSchema — only a `{name, description}`
// pair appears in the system prompt, along with a `tool_search` meta-
// tool. When the model needs a deferred tool, it calls
// `tool_search({ query })` and receives the matching full schemas
// inline; the caller then keeps those schemas in context for the
// subsequent turns of the conversation.
//
// Why this matters: a user with many tools (15–30 built-ins + future
// MCP servers with 20–50 tools each) can easily burn 20–50k tokens
// on tool schemas alone. Deferral brings that cost down to ~1 token
// per tool name, reclaiming those tokens for the actual conversation.
//
// Trade-off: the model pays one extra round-trip when it needs a
// deferred tool. That's fine for rarely-used tools (file operations
// when chatting, git when writing prose). Hot-path tools
// (`update_working_memory`, `plan_tasks`, `update_task_status`)
// should stay eager.

import { countToolSchemas } from './contextEngine'

/** Tools that stay eager regardless of the deferral setting.
 *  Rationale: these are invoked almost every turn, so the round-trip
 *  cost of fetching their schema via `tool_search` would dominate. */
export const ALWAYS_EAGER_TOOLS = new Set<string>([
  'update_working_memory',
  'plan_tasks',
  'update_task_status',
])

/** The meta-tool injected when deferral is enabled. Named
 *  `tool_search` to match Claude's Tool Search Tool beta — if a user
 *  has been using Claude Code they already know how it works. */
export const TOOL_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'tool_search',
    description:
      "Fetch full schema definitions for deferred tools so they can be called. " +
      "Deferred tools appear by name in the system prompt's deferred-tools list, but their parameter schemas are NOT loaded — calling them directly will fail. " +
      "Use this tool with a keyword query or literal `select:name1,name2` form to load the schemas, then call the tool normally. " +
      "Examples: `tool_search({query: \"browser screenshot\"})`, `tool_search({query: \"select:git_command,undo_last_write\"})`.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "Either keywords (match tool name + description) or `select:a,b,c` for exact names. Up to 10 matches returned.",
        },
      },
      required: ['query'],
    },
  },
}

// ─── Auto-deferral decision ────────────────────────────────────────
// Deferral mode is no longer a plain on/off toggle. In 'auto' (the
// default) we decide per-turn from *context pressure*: how big a slice of
// the model's context window the full tool-schema set would occupy. With
// today's 24 built-in tools (~2.2k tokens) that crosses the threshold only
// on tiny local models (Ollama 8k → ~27%), which defer; roomy models (16k+,
// all cloud) stay eager, where the extra round-trip would be pure overhead.
// The ratio is self-scaling: grow the tool set and the crossover rises.

export type DeferralMode = 'auto' | 'on' | 'off'

/** Defer in 'auto' once the full tool schemas would occupy at least this
 *  fraction of the model's context window. 0.15 ≈ "tools shouldn't eat more
 *  than ~1/7 of your context". Measured: 24 built-in tools ≈ 2.2k tokens, so
 *  the crossover sits at ~14.9k context → 8k models defer, 16k+ stay eager. */
export const AUTO_DEFER_CONTEXT_RATIO = 0.15

export interface DeferralDecision {
  enabled: boolean
  mode: DeferralMode
  reason: string
}

/** Decide whether to defer tool schemas this turn.
 *  - 'on'/'off' are explicit user overrides.
 *  - 'auto' (default, incl. when mode is undefined) enables deferral when
 *    `toolTokens / contextLimit >= AUTO_DEFER_CONTEXT_RATIO`. */
export function decideDeferral(
  mode: DeferralMode | undefined,
  contextLimit: number,
  toolTokens: number,
  knownLimit: boolean = true,
): DeferralDecision {
  const m: DeferralMode = mode ?? 'auto'
  if (m === 'on') return { enabled: true, mode: m, reason: 'forced on' }
  if (m === 'off') return { enabled: false, mode: m, reason: 'forced off' }

  // Modelo DESCONHECIDO (caiu no default 8192) — não defere no auto (v2.127.0):
  // pode ser um modelo grande (200k) que só não está na tabela; deferir forçaria
  // um tool_search lento e desnecessário (a classe do bug v2.12.39 no Modal/GLM).
  if (!knownLimit) {
    return { enabled: false, mode: m, reason: 'auto: modelo desconhecido — não defere (evita tool_search à toa)' }
  }

  const ratio = contextLimit > 0 ? toolTokens / contextLimit : 0
  const pct = Math.round(ratio * 100)
  const threshold = Math.round(AUTO_DEFER_CONTEXT_RATIO * 100)
  if (ratio >= AUTO_DEFER_CONTEXT_RATIO) {
    return { enabled: true, mode: m, reason: `auto: tools ~${pct}% of ${contextLimit}t ctx ≥ ${threshold}%` }
  }
  return { enabled: false, mode: m, reason: `auto: tools ~${pct}% of ${contextLimit}t ctx < ${threshold}%` }
}

export interface DeferredPartition {
  eager: unknown[]       // full schemas, injected into the request
  deferredNames: Array<{ name: string; description: string }>  // names only
  metaTool: unknown | null  // tool_search tool, null when no deferral active
  eagerTokens: number
  deferredTokens: number  // BUDGET: potential weight if all fetched
}

interface ToolLike {
  type: string
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

/** Split a list of tools into eager + deferred according to the
 *  enabled flag. When disabled, everything is eager and the function
 *  is a no-op apart from counting. */
export function partitionTools(
  tools: ToolLike[],
  deferralEnabled: boolean,
): DeferredPartition {
  if (!deferralEnabled || tools.length === 0) {
    return {
      eager: tools,
      deferredNames: [],
      metaTool: null,
      eagerTokens: countToolSchemas(tools),
      deferredTokens: 0,
    }
  }

  const eager: ToolLike[] = []
  const deferredNames: Array<{ name: string; description: string }> = []
  const deferredFull: ToolLike[] = []

  for (const t of tools) {
    if (ALWAYS_EAGER_TOOLS.has(t.function.name)) {
      eager.push(t)
    } else {
      deferredNames.push({
        name: t.function.name,
        description: t.function.description || '',
      })
      deferredFull.push(t)
    }
  }

  // Inject tool_search meta-tool into the eager set so the model can
  // actually resolve the deferred names. Without this, deferral is
  // pointless (the model would have no way to fetch schemas).
  const eagerWithMeta = [...eager, TOOL_SEARCH_TOOL]

  return {
    eager: eagerWithMeta,
    deferredNames,
    metaTool: TOOL_SEARCH_TOOL,
    eagerTokens: countToolSchemas(eagerWithMeta),
    deferredTokens: countToolSchemas(deferredFull),
  }
}

/** Render the deferred-tool manifest that goes into the system
 *  prompt. Format is compact and parseable — same shape Claude uses. */
export function renderDeferredManifest(
  deferredNames: Array<{ name: string; description: string }>,
  language: 'pt' | 'en' = 'pt',
): string {
  if (deferredNames.length === 0) return ''
  const header =
    language === 'pt'
      ? `\n\n# Ferramentas disponíveis sob demanda (${deferredNames.length})\n` +
        `Os schemas completos NÃO estão carregados. Para usar qualquer uma delas, ` +
        `chame primeiro \`tool_search\` com uma query de palavras-chave ou \`select:nome1,nome2\`.\n\n`
      : `\n\n# Deferred tools (${deferredNames.length})\n` +
        `Full schemas are NOT loaded. To use any of these, first call \`tool_search\` ` +
        `with a keyword query or \`select:name1,name2\`.\n\n`
  const lines = deferredNames
    .map((t) => {
      // Trim description to first sentence to keep the manifest tight.
      const desc = t.description.split(/[.!?]\s/)[0]
      return `- \`${t.name}\` — ${desc}`
    })
    .join('\n')
  return header + lines
}

/** Resolve a tool_search call into a list of full tool schemas.
 *  Supports two query forms:
 *   - "select:a,b,c"  → exact names, in that order
 *   - keyword search  → rank by token overlap with name+description,
 *                       return top 10.                               */
export function resolveToolSearch(
  query: string,
  allTools: ToolLike[],
): ToolLike[] {
  const q = (query || '').trim()
  if (!q) return []

  // Direct selection
  if (q.startsWith('select:')) {
    const names = q
      .slice('select:'.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const found: ToolLike[] = []
    for (const n of names) {
      const hit = allTools.find((t) => t.function.name === n)
      if (hit) found.push(hit)
    }
    return found
  }

  // Keyword ranking. Score = sum of term hits in name (×3) + description.
  const terms = q
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w) => w.length > 1)
  if (terms.length === 0) return []

  type Scored = { tool: ToolLike; score: number }
  const ranked: Scored[] = allTools.map((tool) => {
    const hay = (tool.function.name + ' ' + (tool.function.description || '')).toLowerCase()
    let score = 0
    for (const term of terms) {
      const nameHit = tool.function.name.toLowerCase().includes(term) ? 3 : 0
      const descHit = hay.includes(term) ? 1 : 0
      score += nameHit + descHit
    }
    return { tool, score }
  })

  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => r.tool)
}

/** Serialize matched tools into the form the model expects in a
 *  tool_result. This is the content the model will read after calling
 *  tool_search; it must be compact and parseable. */
export function formatToolSearchResult(matches: ToolLike[]): string {
  if (matches.length === 0) {
    return 'No matching deferred tools found. Try different keywords or check the deferred-tools list in the system prompt.'
  }
  const lines = matches.map((t) => {
    return `<function>${JSON.stringify({
      description: t.function.description,
      name: t.function.name,
      parameters: t.function.parameters,
    })}</function>`
  })
  return `<functions>\n${lines.join('\n')}\n</functions>`
}
