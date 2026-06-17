// ─── RAG no chat (fusão do RAGPanel — v2.73.0) ──────────────────────
//
// O RAGPanel indexa documentos do usuário (chunks + embeddings via Ollama), mas
// a BUSCA só rodava dentro do próprio painel — o chat nunca consultava a base.
// Esta é a 1ª capacidade "fundida" no chat: a busca vira uma FERRAMENTA
// (rag_search) que a IA aciona sozinha quando a pergunta pode ser respondida
// pelos documentos do usuário, guiada por uma regra clara no system prompt
// (buildRagRouterHint) injetada SÓ quando existe índice. O painel continua vivo
// como a UI de gestão do índice (indexar/limpar). Padrão-template para os
// próximos painéis (Vision, Workflows, etc.).
//
// Helpers PUROS/testáveis; o IPC (ragEmbed/ragSearch/ragStats) é injetado pelo
// chamador (useToolExecution/App). O modelo de embedding TEM de ser o mesmo do
// índice — senão os vetores vivem em espaços diferentes e o score é lixo.

/** Modelo de embedding padrão (igual ao default do RAGPanel). Se o usuário
 *  indexou com outro modelo, alinhe via settings.ragEmbeddingModel. */
export const DEFAULT_RAG_EMBED_MODEL = 'mxbai-embed-large'

export interface RagSearchHit {
  text: string
  source: string
  score: number
}

export interface RagStats {
  count: number
  sources: string[]
}

/** Piso de similaridade para um trecho contar como "relevante". Cosseno de
 *  embeddings de texto raramente cai abaixo disto quando há relação real;
 *  abaixo, é ruído e injetá-lo só polui o contexto. */
export const RAG_MIN_SCORE = 0.2

/** Formata os trechos recuperados para o modelo: cada um com fonte + score,
 *  prontos para citar. Sem hits relevantes → mensagem clara (não inventa). */
export function formatRagResults(hits: RagSearchHit[] | undefined, query: string, minScore = RAG_MIN_SCORE): string {
  const good = (hits || []).filter(
    (h) => h && typeof h.text === 'string' && h.text.trim() && typeof h.score === 'number' && h.score >= minScore,
  )
  if (!good.length) {
    return `Nenhum trecho relevante na base de conhecimento do usuário para "${query}". Responda com seu próprio conhecimento (e diga que não havia nada indexado sobre isso), ou peça ao usuário para indexar o documento.`
  }
  const blocks = good.map(
    (h, i) => `[${i + 1}] fonte: ${h.source || '—'} · score ${h.score.toFixed(2)}\n${h.text.trim()}`,
  )
  return `Trechos relevantes da base de conhecimento LOCAL do usuário (cite a fonte ao usar):\n\n${blocks.join('\n\n')}`
}

/** Bloco de roteamento injetado no system prompt — a "regra clara de
 *  acionamento". Vazio quando NÃO há índice (a IA não é instruída a chamar a
 *  ferramenta à toa). Lista até 8 fontes para o modelo saber o que existe. */
export function buildRagRouterHint(stats: RagStats | null | undefined, lang: string): string {
  const count = stats?.count || 0
  if (count <= 0) return ''
  const sources = (stats?.sources || []).filter(Boolean).slice(0, 8)
  const srcList = sources.length ? sources.join(', ') : '—'
  const more = (stats?.sources?.length || 0) > sources.length ? ', …' : ''
  return lang === 'en'
    ? `[KNOWLEDGE BASE] The user has a LOCAL RAG index with ${count} chunk(s) from: ${srcList}${more}. When the question can be answered from the user's OWN documents/notes — or they refer to "my docs/files/notes/the document" — call rag_search FIRST and cite the source. For general or timeless knowledge, answer directly without it.`
    : `[BASE DE CONHECIMENTO] O usuário tem um índice RAG LOCAL com ${count} trecho(s) de: ${srcList}${more}. Quando a pergunta puder ser respondida pelos PRÓPRIOS documentos/notas do usuário — ou ele citar "meus documentos/arquivos/notas/o documento" — chame rag_search PRIMEIRO e cite a fonte. Para conhecimento geral ou atemporal, responda direto, sem ela.`
}
