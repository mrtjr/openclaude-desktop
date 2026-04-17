// ─── useProviderHealth — pure logic tests ────────────────────────
//
// We avoid @testing-library/react here (pre-existing transitive-dep
// breakage). Instead we exercise the hook through a minimal renderer
// harness provided by React itself — enough to call hooks and read
// their effect-free output.

import { describe, it, expect } from 'vitest'
import { useProviderHealth } from '../src/hooks/useProviderHealth'
import type { AppSettings } from '../src/types'

// Minimal React "renderer" that invokes a hook in a fake fiber context.
// This is a pragmatic stand-in that works because useProviderHealth does
// not rely on effects for the behaviour we're testing in this file.
function callHook<T>(fn: () => T): T {
  // @ts-expect-error — react dispatcher is private but stable enough
  const secret = (require('react') as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  const dispatcher = secret.ReactCurrentDispatcher
  const prev = dispatcher.current
  // Build a dispatcher that returns stable stores for each call.
  const states: any[] = []
  let stateIdx = 0
  const refs: any[] = []
  let refIdx = 0
  const memos: any[] = []
  let memoIdx = 0
  dispatcher.current = {
    useState: (init: any) => {
      if (states.length <= stateIdx) states.push(typeof init === 'function' ? init() : init)
      const i = stateIdx++
      return [states[i], (v: any) => { states[i] = typeof v === 'function' ? v(states[i]) : v }]
    },
    useRef: (init: any) => {
      if (refs.length <= refIdx) refs.push({ current: init })
      return refs[refIdx++]
    },
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => {
      if (memos.length <= memoIdx) memos.push(fn())
      return memos[memoIdx++]
    },
    useEffect: () => {},
    useLayoutEffect: () => {},
    useContext: () => undefined,
    useReducer: (reducer: any, init: any) => [init, () => {}],
  }
  try {
    return fn()
  } finally {
    dispatcher.current = prev
  }
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    provider: 'openai',
    openaiApiKey: '', anthropicApiKey: '', geminiApiKey: '',
    openrouterApiKey: '', modalApiKey: '',
    ...overrides,
  } as AppSettings
}

describe('useProviderHealth.getConfiguredProviders', () => {
  it('always includes ollama (local, no key needed)', () => {
    const h = callHook(() => useProviderHealth(makeSettings()))
    expect(h.getConfiguredProviders()).toContain('ollama')
  })

  it('includes providers with configured keys', () => {
    const h = callHook(() => useProviderHealth(makeSettings({
      openaiApiKey: 'sk-xxx',
      anthropicApiKey: 'sk-ant-yyy',
    })))
    const list = h.getConfiguredProviders()
    expect(list).toContain('openai')
    expect(list).toContain('anthropic')
    expect(list).not.toContain('gemini')
  })

  it('includes custom only when both key AND baseUrl are set', () => {
    const a = callHook(() => useProviderHealth(makeSettings({
      customApiKey: 'x',   // baseUrl missing
    } as any)))
    expect(a.getConfiguredProviders()).not.toContain('custom')

    const b = callHook(() => useProviderHealth(makeSettings({
      customApiKey: 'x',
      customBaseUrl: 'https://api.example.com/v1',
    } as any)))
    expect(b.getConfiguredProviders()).toContain('custom')
  })
})

describe('useProviderHealth.suggestFallback', () => {
  it('returns null when current provider is healthy', () => {
    const h = callHook(() => useProviderHealth(makeSettings({ openaiApiKey: 'sk' })))
    expect(h.suggestFallback()).toBeNull()
  })
})
