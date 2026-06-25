// ─── Tradução de conteúdo multimodal por provider (v2.147.0) ────────
// O app usa o formato OpenAI como canônico no request: o conteúdo de uma
// mensagem é uma string OU um array de partes [{type:'text',text} |
// {type:'image_url',image_url:{url}}] (url = data:<mime>;base64,<b64>). OpenAI/
// OpenRouter/Modal/Custom/Ollama aceitam isso direto. Anthropic e Gemini têm
// formatos próprios — aqui ficam as traduções PURAS e testadas. Só agem quando
// o conteúdo é array (há imagem); string passa intacta (zero impacto no texto).

/** Extrai {mime, b64} de uma data URL, ou null. */
function parseDataUrl(url) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(url || ''))
  return m ? { mime: m[1], b64: m[2] } : null
}

/** OpenAI content → content do Anthropic (string ou blocos {type:'text'|'image'}). */
function toAnthropicContent(content) {
  if (!Array.isArray(content)) return content || ''
  return content.map(part => {
    if (part && part.type === 'image_url') {
      const d = parseDataUrl(part.image_url && part.image_url.url)
      if (d) return { type: 'image', source: { type: 'base64', media_type: d.mime, data: d.b64 } }
      return { type: 'image', source: { type: 'url', url: (part.image_url && part.image_url.url) || '' } }
    }
    return { type: 'text', text: (part && part.text) || '' }
  })
}

/** OpenAI content → parts do Gemini ([{text} | {inline_data:{mime_type,data}}]). */
function toGeminiParts(content) {
  if (!Array.isArray(content)) return [{ text: content || '' }]
  return content.map(part => {
    if (part && part.type === 'image_url') {
      const d = parseDataUrl(part.image_url && part.image_url.url)
      if (d) return { inline_data: { mime_type: d.mime, data: d.b64 } }
      return { text: '' }
    }
    return { text: (part && part.text) || '' }
  })
}

module.exports = { parseDataUrl, toAnthropicContent, toGeminiParts }
