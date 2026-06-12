// ─── browser result formatting — pure ───────────────────────────────
//
// When browser_click misses, the main handler now returns nearby clickable
// candidates (electron/main.js) so the model can re-click in the SAME next
// turn instead of spending a round-trip on get_forms just to discover what
// exists. This formats that for the model. Pure + tested.

export interface ClickCandidate {
  selector: string
  text: string
  tag: string
}

export interface ClickResult {
  success?: boolean
  tag?: string
  text?: string
  error?: string
  candidates?: ClickCandidate[]
}

export function formatClickResult(result: ClickResult, selector: string): string {
  if (result?.error) {
    const cands = result.candidates && result.candidates.length
      ? '\nElementos clicáveis na página (use um destes como selector):\n' +
        result.candidates
          .map((c) => `- "${c.text || '(sem texto)'}" <${c.tag}> → ${c.selector}`)
          .join('\n')
      : ''
    return `Click error: ${result.error}${cands}`
  }
  return `Clicked: ${selector}${result.text ? ` (${result.text})` : ''}`
}
