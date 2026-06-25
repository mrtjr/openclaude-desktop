// ─── Fontes / citações (estilo Perplexity, v2.145.0) ────────────────
// Quando a resposta usou a web (web_search / fetch_url), coletamos as URLs dos
// resultados daquelas ferramentas NESTE turno e mostramos uma lista "Fontes"
// sob a resposta — rastreabilidade/transparência, como o Perplexity.
// Núcleo puro e testado; useChat anexa as fontes à mensagem final.

export interface Source { title: string; url: string }

/** Ferramentas cujos resultados contam como fontes web. */
export const SOURCE_TOOL_NAMES = new Set(['web_search', 'fetch_url'])

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const URL_LINE = /(?:^|\n)\s*URL:\s*(https?:\/\/\S+)/gi

/** Chave de dedupe: host+path sem protocolo/www/query/fragmento/barra final. */
export function normalizeSourceUrl(url: string): string {
  let u = String(url || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  u = u.split('#')[0].split('?')[0].replace(/\/+$/, '')
  return u.toLowerCase()
}

/** Domínio legível (sem www) — vira título quando não há um melhor. */
export function domainOf(url: string): string {
  return normalizeSourceUrl(url).split('/')[0]
}

/** Extrai fontes de um texto de resultado: links markdown `[t](url)` (web_search)
 *  + linhas `URL: http...` (fetch_url). */
export function extractSources(text: string): Source[] {
  const t = String(text || '')
  const out: Source[] = []
  let m: RegExpExecArray | null
  MD_LINK.lastIndex = 0
  while ((m = MD_LINK.exec(t)) !== null) {
    out.push({ title: m[1].trim() || domainOf(m[2]), url: m[2] })
  }
  URL_LINE.lastIndex = 0
  while ((m = URL_LINE.exec(t)) !== null) {
    out.push({ title: domainOf(m[1]), url: m[1] })
  }
  return out
}

/**
 * Coleta as fontes das ferramentas web de um turno e deduplica (preserva ordem,
 * cap em `max`). `items` = chamadas com nome + resultado + args (a url do
 * fetch_url vem dos args quando o resultado não a expõe).
 */
export function collectSources(
  items: Array<{ name?: string; args?: any; result?: string }>,
  max = 12,
): Source[] {
  const seen = new Set<string>()
  const out: Source[] = []
  const add = (s: Source) => {
    if (!s.url) return
    const key = normalizeSourceUrl(s.url)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ title: s.title || domainOf(s.url), url: s.url })
  }
  for (const it of items) {
    if (!it || !SOURCE_TOOL_NAMES.has(String(it.name))) continue
    for (const s of extractSources(it.result || '')) add(s)
    // fetch_url: a url buscada está nos args mesmo quando o resultado não a cita.
    const argUrl = it.args && typeof it.args.url === 'string' ? it.args.url : ''
    if (/^https?:\/\//i.test(argUrl)) add({ title: domainOf(argUrl), url: argUrl })
    if (out.length >= max) break
  }
  return out.slice(0, max)
}
