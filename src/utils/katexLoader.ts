// ─── Lazy KaTeX Loader ──────────────────────────────────────────────
// Math rendering is opt-in *by content*: KaTeX (~280KB) and its stylesheet
// load only the first time a message actually contains math, so the boot
// bundle pays nothing. Once loaded, marked-katex-extension is registered on
// the shared `marked` singleton, so every later render (chat, Parliament,
// Arena, …) typesets math too. Components subscribe via onKatexReady to
// re-render the message that triggered the load (see useMathReady).

import { marked } from 'marked'

type KatexState = 'idle' | 'loading' | 'ready'
let state: KatexState = 'idle'
const listeners = new Set<() => void>()

// Delimiters marked-katex-extension recognises: $$…$$ (display) and $…$
// (inline). Kept conservative so prose like "$5 and $10" does NOT trip it —
// inline requires a non-space hugging both delimiters and no newline inside.
const MATH_RE = /\$\$[\s\S]+?\$\$|\$(?!\s)[^\n$]*?\S\$|\$\S\$/

/** True if the text plausibly contains KaTeX math worth loading the lib for. */
export function hasMath(text: string): boolean {
  return MATH_RE.test(text)
}

/** Whether KaTeX is loaded and registered on `marked`. */
export function isKatexReady(): boolean {
  return state === 'ready'
}

/** Subscribe to the "KaTeX became ready" event. Returns an unsubscribe fn. */
export function onKatexReady(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Kick off the one-time lazy load. Safe to call repeatedly (single-flight).
 *  marked-katex-extension pulls in the KaTeX JS itself; we additionally load
 *  the stylesheet, which the extension does not import. */
export function ensureKatex(): void {
  if (state !== 'idle') return
  state = 'loading'
  Promise.all([
    import('katex/dist/katex.min.css'),
    import('marked-katex-extension'),
  ])
    .then(([, ext]) => {
      // output:'html' avoids MathML so the DOMPurify pass in formatMarkdown
      // keeps the rendered spans intact; throwOnError:false degrades a bad
      // expression to red source text instead of throwing mid-render.
      marked.use(ext.default({ throwOnError: false, output: 'html' }))
      state = 'ready'
      listeners.forEach((l) => l())
    })
    .catch((e) => {
      console.warn('[katex] lazy load failed:', e)
      state = 'idle' // allow a later retry
    })
}
