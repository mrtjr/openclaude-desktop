// ─── Resilient browser navigation (pure helpers) ────────────────────
//
// Electron's `webContents.loadURL` rejects on ANY interrupted load — including
// the benign ones (a client-side redirect, a consent bounce, a JS-triggered
// navigation) that surface as `ERR_ABORTED`. It also never resolves for pages
// whose sub-resources (ads, trackers, long-poll sockets) keep the network busy
// past our NAV_TIMEOUT. The old handler turned BOTH cases into a hard
// `{ error }`, throwing away a page that had already rendered usable content —
// so the agent re-launched + re-navigated from scratch. That is exactly the
// pain the Dev Insights digest shows: `timeout` is the only error kind (4×) and
// browser turns dominate latency (avg ~6.5 min, p95 ~10.5 min), inflated by
// those wasted retry round-trips.
//
// These pure helpers decide WHEN a "failed" navigation actually produced a
// usable page, so the IPC handler can return partial content instead of
// erroring. Kept Electron-free and dependency-free so they're unit-testable.

// Chromium net errors that mean "this load was superseded/blocked, not broken".
const BENIGN_NET_ERRORS = ['ERR_ABORTED', 'ERR_BLOCKED_BY_CLIENT']

/** True when a loadURL rejection is a benign interrupted-load (a redirect or a
 *  client-side navigation), not a real network failure. */
function isBenignNavError(message) {
  if (!message) return false
  const m = String(message)
  if (BENIGN_NET_ERRORS.some((code) => m.includes(code))) return true
  // Electron formats codes like: "ERR_ABORTED (-3) loading 'https://…'".
  if (/\(-3\)/.test(m) || /\berr_aborted\b/i.test(m)) return true
  return false
}

/**
 * Decide what a navigation attempt should return.
 * @param {{ error?: string|null, timedOut?: boolean, finalUrl?: string, textLength?: number }} p
 * @returns {{ ok: boolean, partial: boolean, note: string }}
 *   ok=true  → return the (possibly partial) page to the model
 *   ok=false → genuine failure; `note` carries the error message
 */
function resolveNavOutcome({ error, timedOut, finalUrl, textLength } = {}) {
  const hasContent = (textLength || 0) > 0
  const hasUrl = !!finalUrl && finalUrl !== 'about:blank'

  // Clean load.
  if (!error && !timedOut) return { ok: true, partial: false, note: '' }

  // Interrupted by a redirect / client navigation, but a real page is present.
  if (error && isBenignNavError(error) && hasUrl) {
    return { ok: true, partial: false, note: 'load was interrupted by a redirect; the page is present' }
  }

  // Timed out, yet the page already rendered something usable → partial success.
  if (timedOut && (hasContent || hasUrl)) {
    return {
      ok: true,
      partial: true,
      note: 'navigation timed out; returning the partial page that had already rendered (slow sub-resources were stopped)',
    }
  }

  // Any other error, but content is actually on the page → salvage it.
  if (error && hasContent && hasUrl) {
    return { ok: true, partial: true, note: `load reported "${error}" but page content was captured` }
  }

  // Genuine failure — nothing usable rendered.
  return {
    ok: false,
    partial: false,
    note: error || (timedOut ? 'Navigation timeout (no content rendered)' : 'Navigation failed'),
  }
}

module.exports = { isBenignNavError, resolveNavOutcome, BENIGN_NET_ERRORS }
