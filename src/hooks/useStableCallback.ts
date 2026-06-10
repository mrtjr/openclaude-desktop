import { useCallback, useRef } from 'react'

/**
 * Returns a callback with a PERMANENT identity that always invokes the latest
 * `fn` (the "useEvent" pattern). Use it for handlers passed to memoized
 * children: a handler built with useCallback still changes identity whenever
 * its deps change (e.g. anything reading `activeConv` or `settings` churns on
 * every conversation update), and a single unstable handler prop silently
 * defeats React.memo for the whole list.
 */
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  ref.current = fn
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(((...args: any[]) => ref.current(...args)) as T, [])
}
