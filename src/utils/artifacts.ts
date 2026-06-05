// ─── Artifacts ──────────────────────────────────────────────────────
//
// Claude.ai-style "artifacts": renderable outputs the model produced inside
// the chat. We detect self-contained `html` / `svg` code fences in an
// assistant message and let the UI render them live in a sandboxed iframe
// (see ArtifactPanel) — turning "here's the landing page code" into a real
// preview without leaving the app.

export type ArtifactLang = 'html' | 'svg'

export interface Artifact {
  lang: ArtifactLang
  code: string
  title: string
}

// ```html … ``` or ```svg … ``` fenced blocks.
const FENCE = /```(html|svg)\s*\n([\s\S]*?)```/gi

/** Extract renderable artifacts (html/svg fenced blocks) from message markdown.
 *  Pure; returns [] when there are none. */
export function extractArtifacts(content: string): Artifact[] {
  if (!content) return []
  const out: Artifact[] = []
  FENCE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FENCE.exec(content)) !== null) {
    const lang = m[1].toLowerCase() as ArtifactLang
    const code = m[2].trim()
    if (code) out.push({ lang, code, title: lang === 'svg' ? 'SVG' : 'HTML' })
  }
  return out
}

/** Build the sandboxed document for an artifact. SVG is centered on a white
 *  page; HTML is rendered as-is. */
export function artifactSrcDoc(a: Artifact): string {
  if (a.lang === 'svg') {
    return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${a.code}</body>`
  }
  return a.code
}
