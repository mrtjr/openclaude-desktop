import { useState, useEffect } from 'react'
import { isKatexReady, onKatexReady } from '../utils/katexLoader'

/** Re-renders the host component once lazily-loaded KaTeX becomes ready, so
 *  math that first painted as raw `$…$` upgrades to typeset output. Call it
 *  once in a component that renders Markdown; the return value is incidental. */
export function useMathReady(): boolean {
  const [ready, setReady] = useState(isKatexReady())
  useEffect(() => {
    if (ready) return
    return onKatexReady(() => setReady(true))
  }, [ready])
  return ready
}
