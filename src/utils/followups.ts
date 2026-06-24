// ─── Perguntas de acompanhamento (chips estilo Perplexity, v2.133.0) ──
// Como na referência (Perplexity/ChatGPT), os follow-ups são gerados PELO
// modelo — não por heurística. Para funcionar em todos os provedores sem uma
// chamada extra (custo/latência), pedimos ao modelo que, SÓ no chat normal
// (não no modo agente), termine a resposta com um trailer marcado contendo até
// 3 perguntas curtas. Aqui ficam as partes puras e testadas:
//   - followupInstruction: o texto injetado no system prompt.
//   - parseFollowups: separa o texto visível das perguntas (commit final).
//   - hideFollowupTrailer: esconde o marcador (inclusive parcial) durante o
//     streaming, p/ ele não "piscar" no fim da bolha.
//
// À prova de vazamento: o texto exibido NUNCA contém o marcador. Se o modelo
// não emitir nada parseável, simplesmente não há chips (e o marcador, se veio,
// é removido). Um regex tolerante cobre variações (__FOLLOWUPS__, com espaços
// ou hífen) caso o modelo não copie o marcador ao pé da letra.

import type { Language } from '../types'

/** O marcador canônico que instruímos o modelo a usar. */
export const FOLLOWUP_MARKER = '___FOLLOWUPS___'

// Tolerante: 2+ underscores, FOLLOW(-/espaço)?UPS, 2+ underscores. Global p/
// pegarmos a ÚLTIMA ocorrência (o trailer fica no fim).
const MARKER_RE = /_{2,}\s*FOLLOW[\s-]?UPS\s*_{2,}/gi

function lastMarkerIndex(text: string): number {
  let idx = -1
  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(text)) !== null) {
    idx = m.index
    if (m.index === MARKER_RE.lastIndex) MARKER_RE.lastIndex++ // evita loop em match vazio
  }
  return idx
}

function cleanQuestion(line: string): string {
  return line
    .replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '') // bullets / numeração
    .replace(/^["'“”]+|["'“”]+$/g, '')        // aspas decorativas
    .trim()
}

/**
 * Separa o texto visível das perguntas de acompanhamento. Se não houver
 * marcador, devolve o texto intacto e nenhuma pergunta. O `visible` jamais
 * contém o marcador (anti-vazamento).
 */
export function parseFollowups(text: string): { visible: string; followups: string[] } {
  const idx = lastMarkerIndex(text)
  if (idx === -1) return { visible: text, followups: [] }
  const visible = text.slice(0, idx).replace(/\s+$/, '')
  // Pula o próprio marcador no trecho da cauda.
  const afterMarker = text.slice(idx).replace(MARKER_RE, '')
  const followups = afterMarker
    .split('\n')
    .map(cleanQuestion)
    .filter(l => l.length >= 3 && l.length <= 200)
    .slice(0, 3)
  return { visible, followups }
}

/**
 * Para o STREAMING: remove um marcador completo (e o que vier depois) OU um
 * sufixo parcial do marcador no fim do texto, p/ ele não piscar enquanto é
 * digitado. Só age sobre parciais de comprimento ≥4 (`___F`) p/ não engolir um
 * `___` legítimo de markdown.
 */
export function hideFollowupTrailer(text: string): string {
  const idx = lastMarkerIndex(text)
  if (idx !== -1) return text.slice(0, idx).replace(/\s+$/, '')
  for (let n = FOLLOWUP_MARKER.length - 1; n >= 4; n--) {
    if (text.endsWith(FOLLOWUP_MARKER.slice(0, n))) {
      return text.slice(0, text.length - n).replace(/\s+$/, '')
    }
  }
  return text
}

/** Instrução injetada no system prompt do chat normal (não no modo agente). */
export function followupInstruction(lang: Language): string {
  return lang === 'en'
    ? `When you finish a normal chat answer (NOT while using tools), suggest at most 3 short follow-up questions the user is likely to ask next. Put them at the very END of your message, after a line containing exactly ${FOLLOWUP_MARKER}, one question per line. Do not mention them in the body of your answer and never use that marker anywhere else. If there is no natural follow-up, omit the marker entirely.`
    : `Ao terminar uma resposta de conversa normal (NÃO durante o uso de ferramentas), sugira no máximo 3 perguntas curtas de acompanhamento que o usuário provavelmente faria a seguir. Coloque-as no FINAL da mensagem, após uma linha contendo exatamente ${FOLLOWUP_MARKER}, uma pergunta por linha. Não as mencione no corpo da resposta e nunca use esse marcador em qualquer outro lugar. Se não houver acompanhamento natural, omita o marcador.`
}
