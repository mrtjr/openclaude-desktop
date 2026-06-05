// ─── Elapsed-time formatting ────────────────────────────────────────
//
// Used by the "thinking" timer (components/ThinkingTimer.tsx) to give the user
// a sign of life during long waits — notably Modal's GPU cold start, which can
// run minutes before the first token (see electron/provider-timeouts.js). Pure
// + dependency-free so the formatting is unit-testable.

/**
 * Format an elapsed duration (whole seconds) as a compact human label.
 *   < 1 min → "12s";  ≥ 1 min → "2m 05s".
 * Guards against negative / NaN / fractional input.
 */
export function formatElapsed(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  if (t < 60) return `${t}s`
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}
