// ─── Per-provider request timeout ───────────────────────────────────
//
// The provider HTTP request used a fixed 60s idle timeout. Modal Research
// cold-starts a large model (GLM-5.1-FP8, etc.) in a GPU container, which can
// take well past 60s before the first byte — so the first request after idle
// timed out spuriously (observed in the Dev Insights telemetry: a `timeout`
// error on provider `modal`). Give Modal generous room; keep others tighter
// but still above the old 60s so slow first tokens / reasoning models survive.

function providerTimeoutMs(provider) {
  if (provider === 'modal') return 180000 // 3 min — cold start + big-model inference
  return 90000 // 90s — generous for slow first tokens / reasoning models
}

module.exports = { providerTimeoutMs }
