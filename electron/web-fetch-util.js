// ─── WebFetch-style page reading (pure helpers) ─────────────────────
//
// Lightweight "read a URL" path inspired by Claude's WebFetch: a plain HTTP
// GET + HTML→text extraction with NO browser engine. Most pages are static
// enough to read this way — far cheaper than spinning a Chromium window and,
// crucially, it does NOT pop a visible window for every read (the UX the user
// hit: "qualquer ação abre a página"). When the extracted text is too thin (a
// JS-rendered SPA shell), the caller falls back to the real browser.
//
// Kept Electron-free + dependency-free so it's unit-testable.

const NAMED_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&#39;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&copy;': '©', '&reg;': '®', '&trade;': '™', '&deg;': '°', '&euro;': '€',
}

/** Decode the HTML entities that actually show up in body text (named + numeric). */
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)) } catch { return _ } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return _ } })
    .replace(/&[a-z][a-z0-9]*;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] || m)
}

/** Extract the <title> from raw HTML, decoded + trimmed ('' if none). */
function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html == null ? '' : html))
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ')).trim() : ''
}

/** Strip an HTML document down to readable plain text: drop non-content
 *  elements wholesale, turn block boundaries into newlines, decode entities,
 *  and collapse whitespace runs. */
function htmlToText(html) {
  let s = String(html == null ? '' : html)
  // Remove non-content elements AND their content.
  s = s.replace(/<(script|style|noscript|template|svg|head|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
  // HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  // <br> and closing block tags → newline so paragraphs don't run together.
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|section|article|header|footer|li|ul|ol|tr|table|h[1-6])\s*>/gi, '\n')
  // Every remaining tag → gone.
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  // Collapse whitespace: spaces within a line, then trim around newlines, then
  // cap consecutive blank lines.
  s = s.replace(/[ \t\f\v\r]+/g, ' ')
       .replace(/ *\n */g, '\n')
       .replace(/\n{3,}/g, '\n\n')
       .trim()
  return s
}

/** True when extracted text is too thin to be the real content (likely a
 *  JS-rendered shell) → caller should fall back to the browser engine. */
function looksThin(text, min = 200) {
  return String(text == null ? '' : text).replace(/\s+/g, '').length < min
}

module.exports = { decodeEntities, extractTitle, htmlToText, looksThin, NAMED_ENTITIES }
