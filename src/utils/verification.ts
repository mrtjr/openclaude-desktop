// ─── Chain-of-Verification (auto-verificação, v2.143.0) ─────────────
// Aplica a linha de pesquisa 2026 de self-correction / Chain-of-Verification
// (CoVe): em vez de aceitar a 1ª resposta, o modelo lista as afirmações
// verificáveis, gera perguntas de verificação, responde-as (buscando na web se
// houver a ferramenta) e então CONFIRMA ou CORRIGE. Reduz alucinação.
//
// É opt-in (botão "Verificar" na mensagem) → custa 1 turno extra, então nunca
// roda sozinho. Núcleo puro e testado: o prompt da verificação.

import type { Language } from '../types'

/** Trecho da resposta a verificar (cap p/ não estourar o contexto à toa). */
const ANSWER_BUDGET = 4000

/**
 * Prompt (turno OCULTO) que pede a verificação CoVe de `answer`. Cita a
 * resposta explicitamente para funcionar com qualquer mensagem da conversa,
 * não só a última.
 */
export function verificationPrompt(lang: Language, answer: string): string {
  const a = String(answer ?? '').slice(0, ANSWER_BUDGET)
  if (lang === 'en') {
    return [
      'Verify your previous answer using Chain-of-Verification. The answer to check is:',
      '"""', a, '"""',
      '',
      'Steps:',
      '1. List the concrete, checkable factual claims in that answer.',
      '2. For each claim, write a short verification question.',
      '3. Answer each verification question independently — if a tool like web search is available and the claim is time-sensitive or external, use it.',
      '4. Conclude with a verdict: **Confirmed** (everything holds) or **Corrections** (list what was wrong and give the corrected statement).',
      'Be concise. If you find no verifiable factual claims, say so.',
    ].join('\n')
  }
  return [
    'Verifique sua resposta anterior usando Chain-of-Verification. A resposta a checar é:',
    '"""', a, '"""',
    '',
    'Passos:',
    '1. Liste as afirmações factuais concretas e verificáveis daquela resposta.',
    '2. Para cada afirmação, escreva uma pergunta de verificação curta.',
    '3. Responda cada pergunta de forma independente — se houver uma ferramenta como busca na web e a afirmação for sensível a tempo ou externa, use-a.',
    '4. Conclua com um veredito: **Confirmado** (tudo se sustenta) ou **Correções** (liste o que estava errado e dê a versão corrigida).',
    'Seja conciso. Se não houver afirmações factuais verificáveis, diga isso.',
  ].join('\n')
}
