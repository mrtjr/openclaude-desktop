// ─── Formatação do resultado de tool MCP (puro) ─────────────────────
//
// A varredura (M4) apontou que mcp-call-tool fazia
// `result.content.map(c => c.text||'')` — ignorava result.isError (sucesso e
// erro no MESMO caminho) e os blocos não-texto (image/resource viravam ''
// ou JSON cru). Aqui o parsing PURO discrimina isError e cada tipo de bloco.

/** Formata o resultado de tools/call do MCP em texto para o modelo. Prefixa
 *  "MCP tool error:" quando isError; representa image/resource semanticamente. */
function formatMcpContent(result) {
  if (result == null) return ''
  const content = result.content
  if (!Array.isArray(content)) {
    const body = typeof result === 'string' ? result : JSON.stringify(result)
    return result.isError ? `MCP tool error: ${body}` : body
  }
  const parts = []
  for (const c of content) {
    if (!c || typeof c !== 'object') continue
    if (c.type === 'text' || typeof c.text === 'string') {
      parts.push(String(c.text || ''))
    } else if (c.type === 'image') {
      parts.push(`[image ${c.mimeType || 'data'}]`)
    } else if (c.type === 'resource') {
      const res = c.resource || {}
      const uri = res.uri || c.uri || ''
      parts.push(res.text ? `[resource ${uri}]\n${res.text}` : `[resource ${uri}]`)
    } else {
      parts.push(JSON.stringify(c))
    }
  }
  const body = parts.join('\n').trim()
  return result.isError ? `MCP tool error: ${body || '(sem detalhe)'}` : (body || '(sem conteúdo)')
}

module.exports = { formatMcpContent }
