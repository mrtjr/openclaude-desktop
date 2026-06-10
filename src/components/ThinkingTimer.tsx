import { useEffect, useState } from 'react'
import { formatElapsed } from '../utils/elapsed'

/**
 * Elapsed-time readout shown next to the "thinking" dots while the app waits for
 * the first token. App renders it ONLY during the wait window (loading && no
 * streamed text yet), so this component's mount lifetime == the time spent
 * waiting — `time since mount` is the elapsed time, no external clock needed.
 *
 * Why: the Dev Insights digest shows turns averaging ~5–10 min on Modal/GLM, and
 * Modal's GPU cold start can run minutes before the first byte (see
 * electron/provider-timeouts.js). Bare bouncing dots look frozen during that
 * wait; a ticking timer (plus a hint once it's clearly a long one) tells the
 * user it's working — a pure perceived-latency win, no backend change.
 */
export function ThinkingTimer({ suppressHint = false }: { suppressHint?: boolean } = {}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  // Hold off for a beat so fast responses don't flash a "0s/1s" timer.
  if (elapsed < 3) return null

  return (
    <span className="thinking-timer" aria-live="polite">
      <span className="thinking-elapsed">{formatElapsed(elapsed)}</span>
      {/* The hint talks about MODEL latency — misleading while a tool is
          running (the live running-tool status covers that case instead). */}
      {elapsed >= 20 && !suppressHint && (
        <span className="thinking-hint">modelos grandes podem levar 1–2 min…</span>
      )}
    </span>
  )
}

export default ThinkingTimer
