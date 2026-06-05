// ─── Lazy real tokenizer (js-tiktoken) ──────────────────────────────
//
// Until now token counting was a char/4 heuristic *everywhere*: the live
// footer counter (useTokenCounter), the Claude-style /context panel
// (useContextBreakdown) AND — the high-stakes one — the context-assembly /
// compaction decision in the chat loop (contextEngine.assemble). char/4
// systematically UNDER-counts the dense content that dominates agent turns:
//   JSON tool results  −54%   ({"a":1,"b":[2,3]} → real 11, char/4 5)
//   CJK text           −60%
//   code               ~−11%
// Under-counting is the dangerous direction — it lets the loop keep more
// history than actually fits, so the request overflows the model's real
// context window (hard API error) instead of compacting in time.
//
// This loads the real BPE tokenizer (OpenAI `o200k_base` via js-tiktoken,
// pure-JS, no WASM) ONCE, lazily, after first paint — so the boot bundle
// pays nothing: the ~2.3 MB rank table lives in its own dynamic chunk, the
// same zero-boot-cost pattern the lazy KaTeX loader uses. Until it's ready
// (and in non-UI contexts like unit tests that never trigger the load),
// callers transparently fall back to the char/4 heuristic.
//
// Why o200k_base for every model: it is *exact* for the modern OpenAI
// families (gpt-4o, gpt-4.1, o1/o3/o4) and a *close approximation* for
// Claude / Gemini / local models — none of which publish an exact
// tokenizer — and in every case it is far closer than char/4.

import type { Tiktoken } from 'js-tiktoken/lite'

type TokenizerState = 'idle' | 'loading' | 'ready'
let state: TokenizerState = 'idle'
let encoder: Tiktoken | null = null
const listeners = new Set<() => void>()

// Bounded memo. Message contents are immutable, but the footer counter
// re-sums the whole conversation on every keystroke, so the same string is
// encoded over and over — cache by content to keep that O(1). Cleared
// wholesale past the cap: a crude but allocation-free bound that never
// grows unbounded on a long-running session.
const cache = new Map<string, number>()
const CACHE_CAP = 4000

/** Whether the real tokenizer has finished loading. */
export function isTokenizerReady(): boolean {
  return state === 'ready'
}

/** Subscribe to the "tokenizer became ready" event. Returns an unsubscribe fn. */
export function onTokenizerReady(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Real BPE token count for `text`, or `null` when the tokenizer isn't
 *  loaded yet — in which case the caller falls back to its char/4
 *  heuristic. Never throws: any encode failure degrades to `null`. */
export function realTokenCount(text: string): number | null {
  if (state !== 'ready' || !encoder) return null
  if (!text) return 0
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  try {
    // allowedSpecial=[] + disallowedSpecial=[] → never throw on chat text
    // that happens to contain <|…|> special-token markers; count them as
    // ordinary bytes instead of raising.
    const n = encoder.encode(text, [], []).length
    if (cache.size >= CACHE_CAP) cache.clear()
    cache.set(text, n)
    return n
  } catch {
    return null
  }
}

/** Kick off the one-time lazy load. Safe to call repeatedly (single-flight).
 *  The heavy rank table is pulled via dynamic import, so it lands in its own
 *  chunk and never touches the boot bundle. */
export function ensureTokenizer(): void {
  if (state !== 'idle') return
  state = 'loading'
  Promise.all([
    import('js-tiktoken/lite'),
    import('js-tiktoken/ranks/o200k_base'),
  ])
    .then(([lite, ranks]) => {
      const o200k = (ranks as any).default ?? ranks
      encoder = new lite.Tiktoken(o200k)
      state = 'ready'
      listeners.forEach((l) => l())
    })
    .catch((e) => {
      console.warn('[tokenizer] lazy load failed, staying on heuristic:', e)
      state = 'idle' // allow a later retry
    })
}
