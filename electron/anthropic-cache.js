// ─── Anthropic prompt caching ───────────────────────────────────────
//
// Mark the large, stable request prefix (tool schemas + system prompt) with
// `cache_control: {type:'ephemeral'}` so repeated turns reuse Anthropic's
// prompt cache: cached input tokens bill at ~10% of the normal rate and skip
// re-processing, cutting cost and latency on multi-turn / agent loops. Up to 4
// breakpoints are allowed; we use two (the tool set and the system prompt).
// Below the per-model minimum (~1024 tokens) Anthropic simply ignores the
// breakpoint, so this is always safe/additive. (docs.anthropic.com prompt-caching)

/** Wrap the system prompt as a cached text block. Anthropic accepts `system`
 *  as a string or an array of text blocks; the array form carries cache_control. */
function cachedSystem(systemText) {
  if (!systemText) return undefined
  return [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
}

/** Return a copy of `tools` with cache_control on the LAST tool, so the whole
 *  tool-schema prefix is cached. Input is not mutated. */
function withCachedTools(tools) {
  if (!tools || tools.length === 0) return tools
  const last = tools.length - 1
  return tools.map((t, i) => (i === last ? { ...t, cache_control: { type: 'ephemeral' } } : t))
}

module.exports = { cachedSystem, withCachedTools }
