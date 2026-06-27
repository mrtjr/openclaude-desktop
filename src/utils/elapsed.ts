// ─── Elapsed-time formatting ────────────────────────────────────────
//
// Used by the "thinking" timer (components/ThinkingTimer.tsx) to give the user
// a sign of life during long waits — notably Modal's GPU cold start, which can
// run minutes before the first token (see electron/provider-timeouts.js). Pure
// + dependency-free so the formatting is unit-testable.

/**
 * Format an elapsed duration (whole seconds) as a compact human label.
 *   < 1 min → "12s";  < 1 h → "2m 05s";  ≥ 1 h → "1h 15m" (v2.178.0).
 * Guards against negative / NaN / fractional input.
 */
export function formatElapsed(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  if (t < 60) return `${t}s`
  const m = Math.floor(t / 60)
  const s = t % 60
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  // Horas: sessões de agente / comandos em background podem passar de 1h — sem
  // isto virava "75m 30s". Mantém os minutos com zero à esquerda, omite segundos.
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${String(mm).padStart(2, '0')}m`
}
