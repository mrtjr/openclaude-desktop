// ─── Per-provider request timeout (phase-aware) ─────────────────────
//
// The provider HTTP request uses Node's socket idle timeout (req.setTimeout),
// which fires after N ms of NO activity on the socket. Two very different waits
// share that one timer:
//   1. "connect" — from request start until the FIRST byte. Modal Research
//      cold-starts a big model (GLM-5.1-FP8, …) in a GPU container, so the
//      first byte can take minutes. This is where the `timeout` errors in the
//      Dev Insights digest come from (provider `modal`, the ONLY error kind,
//      non-retryable — the user just loses the turn).
//   2. "stream" — gaps BETWEEN bytes once the response is flowing. A long gap
//      here means the model genuinely stalled, and we want to notice sooner
//      instead of waiting out the whole generous cold-start window.
//
// A single flat timeout forces a bad tradeoff: high enough for cold starts
// means also waiting that entire window on a mid-stream stall. So we expose
// both — a generous "connect" budget and a tighter "stream" idle budget. The
// streaming caller starts on "connect" and, once response headers arrive,
// resets the socket timeout to "stream".

function providerTimeoutMs(provider, phase = 'connect') {
  if (phase === 'stream') {
    // Idle gap once bytes are flowing → a stall; catch it sooner.
    return provider === 'modal' ? 150000 : 90000
  }
  // 'connect' — first byte / cold start. Give Modal generous room (GPU cold
  // start of a large model); keep others tighter but above the old 90s so slow
  // first tokens / reasoning models still survive.
  return provider === 'modal' ? 300000 : 120000
}

// ─── Content-level stall watchdog ────────────────────────────────────
//
// The socket idle timeout above resets on ANY bytes — including SSE
// keep-alives (`: OPENROUTER PROCESSING` comments, Anthropic
// `data: {"type":"ping"}` events). A provider that stalls generation but
// keeps pinging never trips it, and the UI freezes mid-stream on a blinking
// cursor forever. This watchdog counts only *content*: the stream caller
// calls touch() when a real SSE event arrives (text/tool/usage deltas) and
// skips keep-alives. If no content lands within timeoutMs, onStall fires
// once so the caller can destroy the request and unblock the renderer.
function createStallWatchdog(timeoutMs, onStall) {
  let timer = null
  let stopped = false
  const arm = () => {
    timer = setTimeout(() => {
      if (stopped) return
      stopped = true
      onStall()
    }, timeoutMs)
    // Don't hold the process open for a watchdog (no-op in renderers/tests).
    if (timer && typeof timer.unref === 'function') timer.unref()
  }
  arm()
  return {
    touch() {
      if (stopped) return
      clearTimeout(timer)
      arm()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

module.exports = { providerTimeoutMs, createStallWatchdog }
