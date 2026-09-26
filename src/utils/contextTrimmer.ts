// ─── Corte de contexto por CUSTO (middleware, puro) ─────────────────
//
// Roda DEPOIS do contextEngine, que já cabe o histórico no limite real do
// modelo. O teto aqui é de custo por requisição: num modelo de 262k/1M, um loop
// agêntico longo reenviava tudo a cada passo.
//
// A primeira versão guardava só a 1ª mensagem + as 5 últimas — e as últimas
// costumam ser os lembretes `system` que o useChat anexa no fim (memória de
// trabalho, idioma, nudges), então o pedido do usuário sumia da requisição; e
// uma resposta `tool` sem o assistant que a pediu é HTTP 400 na OpenAI e na
// Anthropic. Invariantes agora:
//  - toda mensagem `system` fica (são instruções, não histórico);
//  - a última mensagem do usuário (a tarefa atual) fica, e a troca mais
//    recente do turno também (sem ela o modelo refaz o que acabou de fazer);
//  - corta do MAIS ANTIGO para o mais novo, em blocos: um assistant com
//    tool_calls sai junto com as respostas `tool` dele, nunca separado;
//  - o histórico mantido começa numa mensagem do usuário (a Anthropic exige).

import { IMAGE_TOKEN_ESTIMATE } from './attachments'

type Msg = { role?: string; content?: unknown; tool_calls?: unknown }

function estimateTokens(msg: Msg | null | undefined): number {
  if (!msg) return 0
  let text = ''
  let images = 0
  if (typeof msg.content === 'string') text = msg.content
  else if (Array.isArray(msg.content)) {
    for (const c of msg.content as any[]) {
      if (c?.type === 'text') text += ' ' + String(c.text ?? '')
      else if (c?.type === 'image_url') images++
    }
  }
  let n = Math.ceil(text.length / 4) + images * IMAGE_TOKEN_ESTIMATE
  if (msg.tool_calls) n += Math.ceil(JSON.stringify(msg.tool_calls).length / 4)
  return n
}

const NOTICE = (removed: number) =>
  `<context_compressed> ${removed} mensagens anteriores foram removidas desta requisição para economizar tokens e evitar limite de contexto. Use as ferramentas de RAG ou de memória (conversation_search, memory_read) se precisar relembrar detalhes antigos. </context_compressed>`

export function trimContextWindow<T extends Msg>(messages: T[], maxTokens: number = 80000): T[] {
  if (!Array.isArray(messages) || messages.length <= 6) return messages
  const cost = messages.map(estimateTokens)
  let total = cost.reduce((a, b) => a + b, 0)
  if (total <= maxTokens) return messages

  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { lastUser = i; break }
  }

  // Blocos removíveis, do mais antigo ao mais novo. `tool` gruda no bloco do
  // assistant com tool_calls que o antecede (pulando `system` injetado no meio).
  const blocks: number[][] = []
  let prev = -1 // último índice não-system visto
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m || m.role === 'system') continue
    if (i !== lastUser) {
      const open = blocks[blocks.length - 1]
      const head = open ? messages[open[0]] : undefined
      if (m.role === 'tool' && open && open[open.length - 1] === prev && head?.role === 'assistant' && head.tool_calls) open.push(i)
      else blocks.push([i])
    }
    prev = i
  }
  const blockOf = new Map<number, number[]>()
  for (const b of blocks) for (const i of b) blockOf.set(i, b)

  const newest = blocks[blocks.length - 1]
  const keepNewest = !!newest && newest[0] > lastUser
  const drop = new Set<number>()
  for (const b of blocks) {
    if (total <= maxTokens) break
    if (keepNewest && b === newest) break
    for (const i of b) { drop.add(i); total -= cost[i] }
  }
  // O histórico mantido tem de abrir com o usuário: o que sobrou ANTES do 1º
  // usuário mantido (um assistant cuja pergunta saiu) sai também.
  for (;;) {
    const first = messages.findIndex((m, i) => !!m && m.role !== 'system' && !drop.has(i))
    if (first < 0 || first >= lastUser || messages[first].role === 'user') break
    for (const i of blockOf.get(first) || [first]) drop.add(i)
  }
  if (!drop.size) return messages

  const kept = messages.filter((_, i) => !drop.has(i))
  const at = kept.findIndex((m) => m?.role !== 'system')
  kept.splice(at < 0 ? kept.length : at, 0, { role: 'system', content: NOTICE(drop.size) } as unknown as T)
  return kept
}
