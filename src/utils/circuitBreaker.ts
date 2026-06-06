// ─── Agent loop circuit breaker ─────────────────────────────────────
//
// The agent loop trips a breaker when the model repeats the exact same tool
// call (name + args) and gets stuck. The original check counted matches
// across the ENTIRE session, so a tool legitimately reused much later (same
// `list_directory` path at step 3 and step 40) falsely tripped it — and the
// signature history grew unbounded over a long session. Counting within a
// recent window fixes both: a genuine stuck loop is rapid-fire repetition;
// far-apart reuse is not.

export const CIRCUIT_WINDOW = 8

/** How many times `signature` appears within the last `window` entries of
 *  `recent`. The agent loop trips its breaker when this reaches 2 (i.e. the
 *  3rd identical attempt in the window). */
export function countRecentRepeats(
  recent: string[],
  signature: string,
  window = CIRCUIT_WINDOW,
): number {
  const start = Math.max(0, recent.length - window)
  let n = 0
  for (let i = start; i < recent.length; i++) {
    if (recent[i] === signature) n++
  }
  return n
}

// ─── Idle / no-progress detection ───────────────────────────────────
// The other way an agent loop wastes a slow model (Modal/GLM): it keeps
// emitting tool calls that don't actually advance the goal — only writing
// working memory, or hitting [SYSTEM INTERCEPT] guards (JSON errors / the
// circuit breaker above). After enough consecutive no-progress steps we stop
// the loop instead of grinding to the safety limit (200). This logic used to
// live inline in useChat.processToolCalls, untested; extracted here so it's
// unit-tested alongside the rest of the loop-safety machinery.

/** A tool result counts as real progress UNLESS it's a working-memory write or
 *  a [SYSTEM INTERCEPT] (JSON-parse error / circuit-breaker) — neither advances
 *  the user's goal. */
export function isProgressResult(r: { name: string; result: string }): boolean {
  return r.name !== 'update_working_memory' && !(r.result || '').startsWith('[SYSTEM INTERCEPT]')
}

/** Given a step's tool results and the running idle count, compute the new idle
 *  count and whether the agent loop should continue. A step that made real
 *  progress resets idle to 0; otherwise it increments, and `threshold`
 *  consecutive idle steps stop the loop. */
export function computeAgentProgress(
  results: { name: string; result: string }[],
  idleSteps: number,
  threshold: number,
): { idleSteps: number; continue: boolean } {
  const madeProgress = (results || []).some(isProgressResult)
  const next = madeProgress ? 0 : idleSteps + 1
  return { idleSteps: next, continue: next < threshold }
}
