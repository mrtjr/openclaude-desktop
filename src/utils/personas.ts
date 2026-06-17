// ─── Personas no chat (fusão do PersonaEngine — v2.77.0) ────────────
//
// O PersonaEngine define "personas" (personagens com system prompt próprio —
// Sentinela/Quant/Arquiteto/Poeta + custom), mas a persona ativa NÃO chegava ao
// chat (era só um pill; o loop usava settings.systemPrompt). Aqui:
//   - a persona ativa passa a injetar seu systemPrompt no chat (App), e
//   - a ferramenta set_persona deixa a IA adotar/trocar/limpar a persona quando
//     o usuário pede um papel/tom ("responda como o Sentinela", "vire poeta").
// O painel segue para criar/editar personas.
//
// Helpers PUROS/testáveis. Toma efeito na PRÓXIMA resposta (o system prompt do
// turno atual já foi montado quando a tool roda).

export interface PersonaLike {
  id: string
  name: string
  emoji?: string
  description?: string
  systemPrompt: string
}

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** Palavras que significam "voltar ao padrão / sem persona". */
const CLEAR_WORDS = new Set(['none', 'nenhuma', 'nenhum', 'padrao', 'default', 'limpar', 'clear', 'reset', 'remover', 'sair'])

export function isClearPersona(name: string): boolean {
  return CLEAR_WORDS.has(norm(name))
}

/** Acha persona por id exato, nome exato, ou nome que começa com (fallback p/
 *  "sentinela" casar "Sentinela"). Null se não achar. */
export function findPersona(personas: PersonaLike[] | undefined, nameOrId: string): PersonaLike | null {
  const q = norm(nameOrId)
  if (!q || !Array.isArray(personas)) return null
  return (
    personas.find(p => p && norm(p.id) === q) ||
    personas.find(p => p && norm(p.name) === q) ||
    personas.find(p => p && norm(p.name).startsWith(q)) ||
    null
  )
}

/** Router hint: lista as personas disponíveis + a ativa, e a regra de quando
 *  trocar. Vazio quando não há personas (improvável — há built-ins). */
export function buildPersonaRouterHint(
  personas: PersonaLike[] | undefined,
  activeName: string | null | undefined,
  lang: string,
): string {
  const list = (personas || []).filter(p => p && p.name)
  if (!list.length) return ''
  const items = list.slice(0, 16).map(p => `- ${p.emoji ? p.emoji + ' ' : ''}${p.name}${p.description ? `: ${p.description}` : ''}`)
  const active = activeName
    ? (lang === 'en' ? `Active persona: ${activeName}.` : `Persona ativa: ${activeName}.`)
    : (lang === 'en' ? 'No persona active (default assistant).' : 'Nenhuma persona ativa (assistente padrão).')
  const head = lang === 'en'
    ? '[PERSONAS] When the user asks you to take on a role/character/tone, call set_persona with its name (revert with set_persona "default"). Takes effect on your NEXT reply. Available:'
    : '[PERSONAS] Quando o usuário pedir para você assumir um papel/personagem/tom, chame set_persona com o nome dela (volte com set_persona "padrão"). Vale a partir da PRÓXIMA resposta. Disponíveis:'
  return [head, ...items, active].join('\n')
}

/** Resultado da troca de persona para a IA (persona=null → limpou). */
export function formatSetPersonaResult(persona: PersonaLike | null, lang: string): string {
  if (!persona) {
    return lang === 'en'
      ? 'Persona cleared — back to the default assistant on the next reply.'
      : 'Persona removida — volto ao assistente padrão na próxima resposta.'
  }
  return lang === 'en'
    ? `Persona "${persona.name}" activated — I will respond in character from the next reply.`
    : `Persona "${persona.name}" ativada — responderei nesse personagem a partir da próxima resposta.`
}
