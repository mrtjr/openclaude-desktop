/**
 * Vitest setup file.
 * Stubs browser-only globals that some hooks touch at import time.
 */

// localStorage stub for Node/jsdom (Settings migration, etc.)
if (typeof localStorage === 'undefined') {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
}

// window.electron stub — hooks reference it even when not used
if (typeof (globalThis as any).window !== 'undefined') {
  ;(globalThis as any).window.electron = (globalThis as any).window.electron || {}
}
