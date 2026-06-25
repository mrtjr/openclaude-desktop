// ─── Anexo de documento no chat (v2.148.0) ──────────────────────────
// Complementa o anexo de imagem (v2.147.0): anexar um PDF/DOCX/TXT extrai o
// TEXTO (via read-document no main) e o injeta no request como contexto. Como
// é texto puro, funciona em TODOS os providers (não precisa modelo com visão).
// A bolha mostra só um chip "📄 nome"; o texto completo vai no request.
// Núcleo puro e testado.

export interface DocAttachment {
  name: string
  content: string
  /** Nº de páginas (PDF) — só para exibir. */
  pages?: number
}

/** Cap padrão do texto injetado (~30k tokens). O context engine conta isso e
 *  poda se preciso; o cap evita estourar de uma vez com um PDF gigante. */
export const DOC_CONTEXT_CAP = 120_000

/** Bloco de contexto a injetar no request para um documento anexado. */
export function buildDocumentContext(doc: DocAttachment, cap = DOC_CONTEXT_CAP): string {
  let body = String(doc?.content || '')
  let truncated = false
  if (body.length > cap) { body = body.slice(0, cap); truncated = true }
  const meta = doc?.pages ? ` (${doc.pages} ${doc.pages === 1 ? 'página' : 'páginas'})` : ''
  return `[Documento anexado: ${doc?.name || 'documento'}${meta}]\n"""\n${body}${truncated ? '\n…[documento truncado]' : ''}\n"""`
}

/** Texto final do turno: contexto do documento (se houver) + o texto do usuário. */
export function docPlusText(doc: DocAttachment | undefined, userText: string): string {
  const t = String(userText || '')
  if (!doc) return t
  const ctx = buildDocumentContext(doc)
  return t ? `${ctx}\n\n${t}` : ctx
}
