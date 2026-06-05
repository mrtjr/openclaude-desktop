// ─── Web search helpers (pure, testable) ────────────────────────────
//
// web_search is the user's #1 tool by far (Dev Insights digest: 19× and
// growing). The DuckDuckGo HTML scrape returned raw title/url/snippet with no
// dedup (the same page often appears twice), no caching (an agentic loop that
// refines a query re-scrapes from scratch every time), and a plain-text format
// the model couldn't cite cleanly. These pure helpers fix the first and third;
// the cache Map itself lives in main.js (stateful) but keys/freshness are here
// so the logic is unit-testable without Electron.

/** Normalize a URL for dedup: drop protocol / www / query / fragment / trailing
 *  slashes and lowercase. Two URLs pointing at the same page collapse to one key. */
function normalizeUrl(url) {
  if (!url) return ''
  let u = String(url).trim().toLowerCase()
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '')
  u = u.split(/[?#]/)[0]      // drop query + fragment
  u = u.replace(/\/+$/, '')    // drop trailing slashes
  return u
}

/** Display domain (host without www) for a URL — used in citations. */
function domainOf(url) {
  const n = normalizeUrl(url)
  return n.split('/')[0] || ''
}

/** Dedup results by normalized URL, preserving first occurrence + order.
 *  Drops entries missing a title or url. */
function dedupeResults(results) {
  const seen = new Set()
  const out = []
  for (const r of results || []) {
    if (!r || !r.title || !r.url) continue
    const key = normalizeUrl(r.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/** Citation-ready, markdown-formatted result block for BOTH the model and the
 *  UI. Each source is a clickable markdown link + its domain, numbered so the
 *  model can cite [1], [2]… and the chat renders clickable sources. */
function formatResults(query, results) {
  if (!results || results.length === 0) return `Sem resultados para "${query}".`
  const lines = results.map((r, i) => {
    const dom = domainOf(r.url)
    const snip = r.snippet ? `\n   ${r.snippet}` : ''
    return `${i + 1}. [${r.title}](${r.url})${dom ? ` — ${dom}` : ''}${snip}`
  })
  return `Resultados para "${query}" (${results.length} ${results.length === 1 ? 'fonte' : 'fontes'}):\n\n${lines.join('\n\n')}`
}

/** Stable cache key for a query (case/whitespace-insensitive). */
function cacheKey(query) {
  return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Whether a cache entry is still within its TTL. */
function isFresh(entry, now, ttlMs) {
  return !!entry && typeof entry.ts === 'number' && (now - entry.ts) < ttlMs
}

module.exports = { normalizeUrl, domainOf, dedupeResults, formatResults, cacheKey, isFresh }
