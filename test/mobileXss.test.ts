// ─── XSS no renderizador do app do celular (v2.207.0) ───────────────
//
// O PWA joga a saída do MODELO em innerHTML via renderMarkdown. Como o modelo
// pode ter lido conteúdo da web (injeção indireta), isto é uma superfície real:
// XSS aqui rouba o token de pareamento, que vive no mesmo localStorage.
//
// O renderizador passou nos 12 payloads — este teste existe para que continue
// passando. Ele avalia as funções REAIS extraídas de mobile/app.js e inspeciona
// o DOM resultante, em vez de casar string (um detector por regex acusa texto já
// escapado e dá falso positivo).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
const src = readFileSync('mobile/app.js', 'utf-8')
const grab = (name: string) => {
  const i = src.indexOf(`function ${name}(`)
  let d = 0
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1) } }
  throw new Error(name)
}
const renderMarkdown = new Function([grab('escapeHtml'), grab('mdTable'), grab('renderMarkdown')].join('\n') + '\nreturn renderMarkdown')() as (s: string) => string

// Detector RIGOROSO: parseia o resultado e procura no DOM real.
const inspect = (html: string) => {
  const d = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html')
  const bad: string[] = []
  d.querySelectorAll('*').forEach(el => {
    const tag = el.tagName.toLowerCase()
    if (['script', 'iframe', 'object', 'embed', 'img', 'svg', 'style', 'form'].includes(tag)) bad.push('<' + tag + '>')
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) bad.push(`${tag}[${a.name}]`)
      if (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) bad.push(`${tag}[${a.name}=js]`)
    }
  })
  return bad
}
describe('renderMarkdown do celular neutraliza HTML do modelo', () => {
  it('nenhum payload vira elemento/atributo executável', () => {
    for (const p of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | y |',
      '| <script>alert(1)</script> | b |\n|---|---|\n| x | y |',
      '[clique](javascript:alert(1))',
      '[x](https://a.com" onmouseover="alert(1))',
      '**<img src=x onerror=alert(1)>**',
      '### <img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '[a](https://x.com/<script>alert(1)</script>)',
      '<iframe src=//evil></iframe>',
      '&lt;img src=x onerror=alert(1)&gt;',
    ]) {
      expect(inspect(renderMarkdown(p)), p).toEqual([])
    }
  })
})
