// ─── Auto-evolução de skills (pesquisa 2026: self-evolving skills) ──
// A pedido: a skill evolui conforme é usada e adquire conhecimento. Em vez de
// auto-aplicar (risco de "skill poisoning" — nosso princípio é staging+revisão),
// a IA PROPÕE uma versão melhorada da skill, que o usuário revisa no editor
// antes de salvar. Aqui ficam as partes puras: o prompt e o parser da resposta.

import type { Language } from '../types'

export interface EvolveInput {
  name: string
  description: string
  instructions: string
  examples?: string
  /** Quantas vezes a skill já foi usada (informa o modelo do quanto é exercida). */
  usageCount?: number
}

export interface EvolvedSkill {
  description: string
  instructions: string
  examples?: string
}

const DESC = '___DESCRIPTION___'
const INSTR = '___INSTRUCTIONS___'
const EX = '___EXAMPLES___'

/** Prompt (one-off) que pede ao modelo uma versão melhorada da skill, mantendo
 *  nome e escopo. Saída em seções marcadas p/ parse robusto. */
export function buildEvolvePrompt(s: EvolveInput, lang: Language): string {
  const used = s.usageCount ? (lang === 'en' ? `\n(This skill has been used ~${s.usageCount} times.)` : `\n(Esta skill já foi usada ~${s.usageCount} vezes.)`) : ''
  if (lang === 'en') {
    return [
      'You are an expert at authoring Agent Skills. Improve the skill below WITHOUT changing its scope or name.',
      'Make the instructions clearer, more actionable and standard-compliant (progressive disclosure: concise, concrete examples, explicit "when to use" and termination/done criteria). Keep the same language as the original.' + used,
      '',
      `Name: ${s.name}`,
      `Current description: ${s.description}`,
      'Current instructions:',
      '"""', s.instructions, '"""',
      ...(s.examples ? ['Current examples:', '"""', s.examples, '"""'] : []),
      '',
      `Reply EXACTLY in this format and nothing else:`,
      DESC, '<improved one-line description: when to use this skill>',
      INSTR, '<improved instructions>',
      `${EX} (optional)`, '<concrete examples, or omit this section>',
    ].join('\n')
  }
  return [
    'Você é um especialista em criar Agent Skills. Melhore a skill abaixo SEM mudar o escopo nem o nome.',
    'Deixe as instruções mais claras, acionáveis e dentro do padrão (progressive disclosure: conciso, exemplos concretos, "quando usar" e critério de término explícitos). Mantenha a mesma língua do original.' + used,
    '',
    `Nome: ${s.name}`,
    `Descrição atual: ${s.description}`,
    'Instruções atuais:',
    '"""', s.instructions, '"""',
    ...(s.examples ? ['Exemplos atuais:', '"""', s.examples, '"""'] : []),
    '',
    'Responda EXATAMENTE neste formato e nada mais:',
    DESC, '<descrição melhorada em uma linha: quando usar esta skill>',
    INSTR, '<instruções melhoradas>',
    `${EX} (opcional)`, '<exemplos concretos, ou omita esta seção>',
  ].join('\n')
}

/** Parseia a resposta marcada em { description, instructions, examples? }.
 *  Null se não houver instruções (resposta inutilizável). Tolerante a lixo. */
export function parseEvolvedSkill(text: string): EvolvedSkill | null {
  const t = String(text || '')
  const di = t.indexOf(DESC)
  const ii = t.indexOf(INSTR)
  if (ii === -1) return null
  const ei = t.indexOf(EX)
  const description = di !== -1 ? clean(t.slice(di + DESC.length, ii)) : ''
  const instrEnd = ei !== -1 && ei > ii ? ei : t.length
  const instructions = clean(t.slice(ii + INSTR.length, instrEnd))
  if (!instructions) return null
  const examples = ei !== -1 && ei > ii ? clean(t.slice(ei + EX.length)) : ''
  return { description, instructions, ...(examples ? { examples } : {}) }
}

function clean(s: string): string {
  return String(s || '')
    .replace(/^\s*\(opcional\)\s*/i, '')
    .replace(/^\s*\(optional\)\s*/i, '')
    .replace(/^\s*"""\s*|\s*"""\s*$/g, '')
    .trim()
}
