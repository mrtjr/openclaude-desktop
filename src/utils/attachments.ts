// ─── Dropped-file attachment formatting ─────────────────────────────
//
// Files dragged into the chat become a fenced block in the composer. The old
// inline code clipped content at 5 000 chars with NO marker — for this user's
// MT5 logs and backtest CSVs that silently discarded 99% of the file and the
// model answered as if it had seen everything. Pure + tested here.

/** Max characters of file content injected into the composer (~5k tokens). */
export const DROPPED_FILE_MAX_CHARS = 20_000

/** Build the composer text for a dropped file. Content beyond `max` is
 *  clipped WITH an explicit marker so neither the user nor the model can
 *  mistake a partial file for the whole thing. */
export function formatDroppedFile(name: string, content: string, max = DROPPED_FILE_MAX_CHARS): string {
  const body = content.length > max ? content.slice(0, max) : content
  const marker = content.length > max
    ? `\n[TRUNCADO: mostrando ${max} de ${content.length} caracteres do arquivo]`
    : ''
  const inner = `${body}${marker}`
  // Cerca mais longa que QUALQUER sequência de crases no conteúdo (CommonMark):
  // um arquivo que contém ``` (markdown/código) não fecha o bloco cedo demais
  // — antes isso corrompia a renderização e confundia o modelo (v2.181.0).
  const longestRun = (inner.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0)
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `[Arquivo: ${name}]\n${fence}\n${inner}\n${fence}\n`
}

// ─── Omni-input: lista de anexos (v2.212.0) ─────────────────────────
//
// Antes o composer tinha UM slot de imagem e UM de documento. Soltar três
// imagens de uma vez rodava o loop do drop três vezes sobre o mesmo slot — só
// a última sobrevivia, sem aviso. Código/texto nem virava anexo: era despejado
// DENTRO da caixa de texto. Agora é uma lista, e cada arquivo vira um card.
//
// Tudo aqui é puro: classificação, limites, dedupe, e a montagem do conteúdo
// canônico (formato OpenAI) que o main traduz para Anthropic/Gemini.

import { imageDataUrl } from './multimodal'

export type ImageAttachmentItem = { kind: 'image'; name: string; mimeType: string; base64: string }
export type DocumentAttachmentItem = { kind: 'document'; name: string; content: string; pages?: number }
export type Attachment = ImageAttachmentItem | DocumentAttachmentItem

/** Teto de anexos por mensagem. Dez imagens já custam ~16k tokens. */
export const MAX_ATTACHMENTS = 10
/** Teto por documento (~30k tokens) — o mesmo DOC_CONTEXT_CAP de antes. */
export const DOC_ITEM_CAP = 120_000
/** Teto da SOMA dos documentos de uma mensagem. Sem ele, dez arquivos de 120k
 *  entrariam inteiros e estourariam a janela antes de o contextEngine podar. */
export const DOC_TOTAL_CAP = 200_000
/** Estimativa de tokens por imagem para o ORÇAMENTO de contexto. O base64 não é
 *  texto, então o contador ignorava imagens — com uma, erro pequeno; com dez,
 *  ~16k tokens invisíveis. 1600 é o teto prático da Anthropic (imagem de ~1.15
 *  megapixel); superestimar só faz compactar um pouco antes. */
export const IMAGE_TOKEN_ESTIMATE = 1600

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
/** Precisam de extração no main (pdf-parse / mammoth). */
const RICH_DOC_EXT = new Set(['pdf', 'docx', 'doc'])
/** Lidos como texto puro. Inclui os do MT5 (mq4/mq5/mqh), que este usuário usa. */
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonc', 'json5',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'xml', 'svg',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'fs', 'swift', 'm', 'mm', 'dart',
  'php', 'lua', 'r', 'jl', 'pl', 'ex', 'exs', 'erl', 'clj', 'hs', 'elm', 'zig', 'nim',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto', 'tf', 'hcl', 'pine',
  'mq4', 'mq5', 'mqh',
])
/** Arquivos de texto sem extensão, reconhecidos pelo nome. */
const TEXT_BASENAMES = new Set(['dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile', 'license', 'readme'])

export type DroppedKind = 'image' | 'rich-document' | 'text' | 'unknown'

/** Para onde o arquivo arrastado vai. `unknown` = tentar como texto e recusar
 *  se for binário (ver looksBinary). */
export function classifyDroppedFile(fileName: string): DroppedKind {
  const base = String(fileName ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1) : ''
  if (IMAGE_EXT.has(ext)) return 'image'
  if (RICH_DOC_EXT.has(ext)) return 'rich-document'
  if (TEXT_EXT.has(ext)) return 'text'
  if (!ext && TEXT_BASENAMES.has(base)) return 'text'
  return 'unknown'
}

/** Heurística de binário: NUL, ou muitos caracteres de substituição (U+FFFD)
 *  — o que sobra quando bytes que não são UTF-8 são lidos como texto. Mandar
 *  um .exe decodificado como "documento" só queima contexto com lixo. */
export function looksBinary(text: string): boolean {
  const s = String(text ?? '')
  if (!s) return false
  if (s.includes('\u0000')) return true
  const sample = s.slice(0, 8000)
  let bad = 0
  for (const ch of sample) if (ch === '\uFFFD') bad++
  return bad / sample.length > 0.02
}

export type AddAttachmentError = 'limit' | 'duplicate' | 'empty'

/** Acrescenta um anexo. Devolve a lista nova, ou um erro que a UI traduz. Não
 *  muta a entrada. Duplicata = mesmo tipo, mesmo nome e mesmo tamanho: soltar o
 *  mesmo arquivo duas vezes não deve mandá-lo duas vezes ao modelo. */
export function addAttachment(list: Attachment[], next: Attachment): { list: Attachment[]; error?: AddAttachmentError } {
  const cur = Array.isArray(list) ? list : []
  const size = (a: Attachment) => (a.kind === 'image' ? a.base64.length : a.content.length)
  if (!next || (next.kind === 'image' ? !next.base64 : !String(next.content ?? '').trim())) {
    return { list: cur, error: 'empty' }
  }
  if (cur.some(a => a.kind === next.kind && a.name === next.name && size(a) === size(next))) {
    return { list: cur, error: 'duplicate' }
  }
  if (cur.length >= MAX_ATTACHMENTS) return { list: cur, error: 'limit' }
  return { list: [...cur, next] }
}

/** Remove o anexo na posição `index` (fora do intervalo = lista intacta). */
export function removeAttachmentAt(list: Attachment[], index: number): Attachment[] {
  const cur = Array.isArray(list) ? list : []
  if (index < 0 || index >= cur.length) return cur
  return cur.filter((_, i) => i !== index)
}

function escapeAttr(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Neutraliza `</document` DENTRO do conteúdo. Um arquivo que contenha essa
 *  sequência fecharia a tag cedo, e o resto dele passaria a parecer texto do
 *  usuário — um vetor de injeção vindo de um arquivo arrastado. */
function neutralizeClosingTag(body: string): string {
  return body.replace(/<\/(document)/gi, '<\\/$1')
}

/** Bloco estruturado de UM documento. `budget` = caracteres ainda disponíveis
 *  no teto total da mensagem. */
export function renderDocumentBlock(doc: DocumentAttachmentItem, budget: number = DOC_ITEM_CAP): string {
  const name = escapeAttr(doc?.name || 'documento')
  const pages = doc?.pages ? ` pages="${doc.pages}"` : ''
  const full = String(doc?.content ?? '')
  const cap = Math.max(0, Math.min(DOC_ITEM_CAP, budget))
  if (cap === 0) {
    return `<document name="${name}"${pages} omitted="true">\n[omitido: o limite total de anexos desta mensagem já foi atingido]\n</document>`
  }
  const body = full.length > cap ? full.slice(0, cap) : full
  const marker = full.length > cap ? `\n[TRUNCADO: ${cap} de ${full.length} caracteres]` : ''
  return `<document name="${name}"${pages}>\n${neutralizeClosingTag(body)}${marker}\n</document>`
}

/** Texto dos documentos, respeitando o teto por item E o teto total. */
export function renderDocuments(attachments: Attachment[]): string {
  let remaining = DOC_TOTAL_CAP
  const blocks: string[] = []
  for (const a of Array.isArray(attachments) ? attachments : []) {
    if (a?.kind !== 'document') continue
    blocks.push(renderDocumentBlock(a, remaining))
    remaining = Math.max(0, remaining - Math.min(DOC_ITEM_CAP, String(a.content ?? '').length))
  }
  return blocks.join('\n\n')
}

/**
 * Conteúdo canônico (formato OpenAI) de uma mensagem do usuário com anexos.
 * - Sem imagem: string — documentos NO TOPO, pergunta no fim (a ordem que os
 *   provedores recomendam para contexto longo).
 * - Com imagem: array de partes — as imagens primeiro, depois UMA parte de
 *   texto com documentos + pergunta. O main traduz esse array para o formato
 *   de cada provedor (electron/multimodal.js).
 * Sem anexos, devolve o texto intacto.
 */
export function buildAttachmentContent(attachments: Attachment[], userText: string): string | Array<Record<string, unknown>> {
  const list = Array.isArray(attachments) ? attachments : []
  const text = String(userText ?? '')
  const docs = renderDocuments(list)
  const textPart = docs ? (text.trim() ? `${docs}\n\n${text}` : docs) : text
  const images = list.filter((a): a is ImageAttachmentItem => a?.kind === 'image' && !!a.base64)
  if (!images.length) return textPart
  const parts: Array<Record<string, unknown>> = images.map(img => ({
    type: 'image_url', image_url: { url: imageDataUrl(img) },
  }))
  if (textPart.trim()) parts.push({ type: 'text', text: textPart })
  return parts
}

/** Anexos de uma mensagem, com compatibilidade: conversas salvas antes da
 *  v2.212.0 guardam `image` e `document` avulsos — continuam valendo. */
export function messageAttachments(m: {
  attachments?: Attachment[]
  image?: { base64: string; mimeType: string; name: string }
  document?: { name: string; content: string; pages?: number }
} | null | undefined): Attachment[] {
  if (!m) return []
  if (Array.isArray(m.attachments) && m.attachments.length) return m.attachments
  const out: Attachment[] = []
  if (m.image?.base64) out.push({ kind: 'image', name: m.image.name, mimeType: m.image.mimeType, base64: m.image.base64 })
  if (m.document?.content) out.push({ kind: 'document', name: m.document.name, content: m.document.content, pages: m.document.pages })
  return out
}

/** Tokens que os anexos somam ao contexto. Os documentos são medidos pelo TEXTO
 *  QUE REALMENTE VAI no request (já com os tetos), não pelo arquivo cru. */
export function attachmentsTokenEstimate(attachments: Attachment[], countText: (s: string) => number): number {
  const list = Array.isArray(attachments) ? attachments : []
  if (!list.length) return 0
  const docs = renderDocuments(list)
  const images = list.filter(a => a?.kind === 'image').length
  return (docs ? countText(docs) : 0) + images * IMAGE_TOKEN_ESTIMATE
}
