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
