// ─── Agent-turn message grouping (v2.12.71) ─────────────────────────
// A long agent turn produces one assistant message PER TOOL STEP — the
// digest shows ~12 execute_commands per turn, which used to render as
// twelve full message blocks (avatar + footer + action buttons each).
// This groups consecutive tool-step messages so the chat shows a single
// compact, collapsible "N passos" block instead of a wall of noise.
//
// Pure + unit-tested; App.tsx memoizes the result per messages identity.

import type { Message } from '../types'

export type RenderItem =
  | { kind: 'single'; msg: Message }
  | { kind: 'steps'; key: string; msgs: Message[] }

/** A message is a tool step when the assistant called tools in it. The
 *  final answer of a turn never has toolCalls, so it stays standalone. */
export function isToolStep(m: Message): boolean {
  return m.role === 'assistant' && !!m.toolCalls && m.toolCalls.length > 0
}

/**
 * Collapse consecutive runs of >= minRun tool-step messages into a single
 * 'steps' item (keyed by the first message id, stable across re-renders).
 * Runs of 1 keep today's rendering — a lone tool call is already compact.
 */
export function groupMessages(messages: Message[], minRun = 2): RenderItem[] {
  const items: RenderItem[] = []
  let run: Message[] = []
  const flush = () => {
    if (run.length >= minRun) {
      items.push({ kind: 'steps', key: run[0].id, msgs: run })
    } else {
      for (const m of run) items.push({ kind: 'single', msg: m })
    }
    run = []
  }
  for (const m of messages) {
    if (isToolStep(m)) run.push(m)
    else { flush(); items.push({ kind: 'single', msg: m }) }
  }
  flush()
  return items
}

/** Header summary for a steps group: tool counts + error count.
 *  Ex.: { counts: [['execute_command', 9], ['web_search', 1]], errors: 2 } */
export function summarizeSteps(
  msgs: Message[],
  isError: (result: string, toolName: string) => boolean,
): { total: number; counts: Array<[string, number]>; errors: number } {
  const byName = new Map<string, number>()
  let total = 0
  let errors = 0
  for (const m of msgs) {
    m.toolCalls?.forEach((tc, i) => {
      total++
      byName.set(tc.name, (byName.get(tc.name) || 0) + 1)
      const res = m.toolResults?.[i]?.result || ''
      if (res && isError(res, tc.name)) errors++
    })
  }
  const counts = [...byName.entries()].sort((a, b) => b[1] - a[1])
  return { total, counts, errors }
}
