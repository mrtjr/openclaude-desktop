// ─── Anexo de imagem no chat (lado renderer, v2.147.0) ──────────────
// Monta o conteúdo multimodal canônico (formato OpenAI: array de partes) a
// partir de uma imagem anexada + o texto. A tradução por-provider (Anthropic/
// Gemini) acontece no main (electron/multimodal.js). Puro e testável.

export interface ImageAttachment {
  base64: string
  mimeType: string
  name: string
}

/** data URL da imagem (usada na bolha e no bloco image_url). */
export function imageDataUrl(img: ImageAttachment): string {
  return `data:${img.mimeType};base64,${img.base64}`
}

/**
 * Conteúdo OpenAI-compat (array) com a imagem + o texto. A imagem vem primeiro
 * (convenção dos provedores). Se não houver texto, manda só a imagem.
 */
export function imageContentBlocks(img: ImageAttachment, text: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    { type: 'image_url', image_url: { url: imageDataUrl(img) } },
  ]
  if (text && text.trim()) blocks.push({ type: 'text', text })
  return blocks
}
