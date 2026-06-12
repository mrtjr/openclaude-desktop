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

export interface NavElements {
  links?: { text: string; href: string }[]
  fields?: { tag: string; type: string; placeholder: string; selector: string }[]
}

export interface NavResult {
  title?: string
  url?: string
  text?: string
  partial?: boolean
  note?: string
  elements?: NavElements
}

/** Format a browser_navigate result. With no `elements`, the output is
 *  byte-identical to the previous inline formatter (zero regression); when
 *  present, a compact interactive-elements block is appended so the model can
 *  click/type next turn without a separate get_links/get_forms call. */
export function formatNavResult(r: NavResult): string {
  let out = `Navigated to: ${r.title}\nURL: ${r.url}`
  if (r.partial) out += `\n⚠️ Partial load: ${r.note}`
  out += `\n\nPage content:\n${r.text || '(empty)'}`
  const el = r.elements
  const hasLinks = !!(el && el.links && el.links.length)
  const hasFields = !!(el && el.fields && el.fields.length)
  if (hasLinks || hasFields) {
    out += '\n\nInteractive elements (use these selectors with browser_click / browser_type):'
    if (hasLinks) {
      out += '\nLinks:\n' + el!.links!.map((l) => `- "${l.text}" → ${l.href}`).join('\n')
    }
    if (hasFields) {
      out += '\nFields:\n' + el!.fields!.map((f) =>
        `- <${f.tag}>${f.type ? ` type="${f.type}"` : ''}${f.placeholder ? ` placeholder="${f.placeholder}"` : ''} → ${f.selector}`,
      ).join('\n')
    }
  }
  return out
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
