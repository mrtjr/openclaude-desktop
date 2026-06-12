// ─── Fase invisível do streaming ─────────────────────────────────────
//
// Modelos de raciocínio (GLM-5.1, DeepSeek-R1, o3…) e tool calls grandes
// streamam por MINUTOS sem nenhum `delta.content` — o vLLM manda
// `delta.reasoning_content`, o OpenRouter manda `delta.reasoning`, e os
// argumentos de tool chegam em `delta.tool_calls[].function.arguments`.
// A UI só renderiza `delta.content`, então o usuário via um cursor piscando
// parado e reportava "travou" (era progresso real, só que invisível —
// confirmado nos Dev Insights: gaps de 12 min entre tools, conexão viva).
//
// `nextStreamPhase` é o redutor puro: dado a fase atual e um delta do chunk,
// devolve a nova fase, `null` (texto visível voltou → some o indicador) ou
// `undefined` (nada mudou — permite throttle barato no chamador).

export type StreamPhase = {
  kind: 'reasoning' | 'tool'
  /** Nome da tool sendo montada (quando conhecido). */
  tool?: string
  /** Total de caracteres invisíveis acumulados — o contador subindo é o sinal de vida. */
  chars: number
} | null

export function nextStreamPhase(prev: StreamPhase, delta: any): StreamPhase | undefined {
  if (!delta || typeof delta !== 'object') return undefined

  // Raciocínio: vLLM/DeepSeek usam reasoning_content; OpenRouter usa reasoning.
  const reasoning =
    (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
    (typeof delta.reasoning === 'string' && delta.reasoning) || ''

  // Tool call sendo montada: conta os bytes de argumentos que chegam.
  let toolChars = 0
  let toolName = ''
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      if (typeof tc?.function?.arguments === 'string') toolChars += tc.function.arguments.length
      if (!toolName && typeof tc?.function?.name === 'string') toolName = tc.function.name
    }
  }

  // Tool call tem precedência: raciocínio costuma vir ANTES da tool, e o
  // momento "montando write_file" é a informação mais útil das duas.
  if (toolChars > 0 || toolName) {
    const carried = prev?.kind === 'tool' ? prev.chars : 0
    return { kind: 'tool', tool: toolName || (prev?.kind === 'tool' ? prev.tool : undefined), chars: carried + toolChars }
  }
  if (reasoning) {
    const carried = prev?.kind === 'reasoning' ? prev.chars : 0
    return { kind: 'reasoning', chars: carried + reasoning.length }
  }

  // Texto visível voltou a fluir → o cursor já mostra progresso; limpa.
  if (typeof delta.content === 'string' && delta.content.length > 0) {
    return prev === null ? undefined : null
  }
  return undefined
}

/** "850" / "3,4k" — contador compacto para o indicador (pt-BR). */
export function formatCharCount(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1).replace('.', ',')}k`
}

/** Rótulo pronto para a UI: "raciocinando… 3,4k chars" / "montando write_file… 12,1k chars". */
export function streamPhaseLabel(phase: NonNullable<StreamPhase>): string {
  const count = `${formatCharCount(phase.chars)} chars`
  if (phase.kind === 'tool') return `montando ${phase.tool || 'tool call'}… ${count}`
  return `raciocinando… ${count}`
}
