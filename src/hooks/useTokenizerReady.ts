import { useState, useEffect } from 'react'
import { isTokenizerReady, onTokenizerReady, ensureTokenizer } from '../services/tokenizer'

/** Triggers the one-time lazy tokenizer load after first paint and
 *  re-renders the host once it's ready, so token counts sharpen from the
 *  char/4 heuristic to real BPE counts. Mirrors useMathReady. Call it in
 *  any component/hook whose output depends on an accurate token count —
 *  include the returned `ready` flag in your memo deps so the figure
 *  recomputes the moment the tokenizer arrives. */
export function useTokenizerReady(): boolean {
  const [ready, setReady] = useState(isTokenizerReady())
  useEffect(() => {
    if (ready) return
    ensureTokenizer() // kick off lazy load after first paint — zero boot cost
    return onTokenizerReady(() => setReady(true))
  }, [ready])
  return ready
}
