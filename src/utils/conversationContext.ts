// ─── Continuar a partir de outra conversa (v2.58.0) ────────────────
//
// Permite iniciar uma conversa nova "puxando" o contexto de uma conversa
// anterior: renderiza a conversa-fonte em texto e injeta no `contextSummary` da
// nova (que o useChat já injeta todo turno como "[CONTEXT SUMMARY]"). Assim a IA
// lê tudo o que foi feito e continua a partir dali. Verbatim quando cabe; o
// chamador resume via LLM quando passa do orçamento. Helper PURO/testável.

import type { Conversation } from '../types'

/** Acima disto (chars), o chamador deve RESUMIR em vez de injetar verbatim
 *  (~6k tokens). Mantém o contexto importado barato o suficiente p/ ir todo turno. */
export const IMPORT_VERBATIM_CHAR_BUDGET = 24000

/** Renderiza a conversa em um transcript legível (Usuário/Assistente + saídas de
 *  ferramentas truncadas) para virar contexto de outra conversa. */
export function renderConversationTranscript(
  conv: Conversation,
  opts: { maxResultChars?: number } = {},
): string {
  const maxResult = opts.maxResultChars ?? 1200
  const out: string[] = [`# ${conv?.title || 'Conversa'}`]
  for (const m of conv?.messages || []) {
    if (m.role === 'user') {
      if (m.content?.trim()) out.push(`\n## Usuário\n${m.content.trim()}`)
    } else if (m.role === 'assistant') {
      if (m.content?.trim()) out.push(`\n## Assistente\n${m.content.trim()}`)
      if (m.toolCalls) {
        m.toolCalls.forEach((tc, i) => {
          out.push(`\n### Ferramenta: ${tc.name}`)
          const r = m.toolResults?.[i]?.result
          if (r) out.push(`Resultado: ${r.length > maxResult ? r.slice(0, maxResult) + ' …[truncado]' : r}`)
        })
      }
    }
  }
  if (conv?.contextSummary?.trim()) out.push(`\n## Contexto anterior\n${conv.contextSummary.trim()}`)
  return out.join('\n').trim()
}

/** Monta o bloco final de contexto importado, com cabeçalho instruindo a IA a
 *  assimilar e continuar (e a NÃO refazer o que já foi feito). */
export function buildImportedContextBlock(sourceTitle: string, body: string): string {
  return [
    `[CONTEXTO IMPORTADO da conversa "${sourceTitle}"] O usuário quer CONTINUAR a partir desta conversa.`,
    'Assimile tudo o que foi feito abaixo e prossiga a partir daqui; REUSE estes achados — não refaça o que já está pronto.',
    '',
    body,
  ].join('\n')
}
