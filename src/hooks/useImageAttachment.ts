/**
 * useImageAttachment.ts — v1.9.0
 * Hook para gerenciar upload de imagens no chat.
 * Suporta: seletor de arquivo nativo (via electron), drag-and-drop, colar da área de transferência.
 *
 * Retorna:
 *   - attachedImage: { base64, mimeType, name } | null
 *   - attachFile(): abre o dialog nativo do Electron
 *   - attachFromBase64(base64, mimeType, name): vincula imagem já em base64
 *   - clearAttachment(): remove a imagem
 *   - buildImageContent(text): monta o content array para a API (OpenAI/Anthropic/Gemini format)
 */
import { useState, useCallback } from 'react'

export interface ImageAttachment {
  base64:   string
  mimeType: string
  name:     string
}

const el = (window as any).electron

export function useImageAttachment() {
  const [attachedImage, setAttachedImage] = useState<ImageAttachment | null>(null)

  /** Abre o file dialog do Electron e carrega a imagem selecionada */
  const attachFile = useCallback(async () => {
    if (!el?.openFileDialog) return
    const { filePath, error } = await el.openFileDialog({
      title: 'Selecionar imagem',
      filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','gif','webp','bmp'] }],
    })
    if (!filePath || error) return

    const { base64, mimeType, name, isImage, error: readErr } = await el.readDocument(filePath)
    if (readErr || !isImage) return
    setAttachedImage({ base64, mimeType, name })
  }, [])

  /** Vincula imagem já em base64 (ex: drag-and-drop, paste) */
  const attachFromBase64 = useCallback((base64: string, mimeType: string, name: string) => {
    setAttachedImage({ base64, mimeType, name })
  }, [])

  const clearAttachment = useCallback(() => setAttachedImage(null), [])

  /**
   * Monta o array `content` para enviar à API junto com o texto.
   * Compatível com OpenAI, Anthropic e Gemini (via provider-chat no main.js).
   */
  const buildImageContent = useCallback((text: string): string | object[] => {
    if (!attachedImage) return text
    return [
      {
        type: 'image_url',
        image_url: { url: `data:${attachedImage.mimeType};base64,${attachedImage.base64}` },
      },
      { type: 'text', text },
    ]
  }, [attachedImage])

  return { attachedImage, attachFile, attachFromBase64, clearAttachment, buildImageContent }
}
