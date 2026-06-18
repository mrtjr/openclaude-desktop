// ─── Output styles (v2.97.0) ────────────────────────────────────────
//
// Porta os "output styles" do Claude Code: presets de FORMATO da resposta
// (conciso, explicativo, ensino, só-código), independentes das personas (que
// trocam a VOZ/identidade). Cada estilo adiciona uma instrução curta ao system
// prompt. É dado puro + um resolvedor testável; o useChat injeta.

export interface OutputStyle {
  id: string
  name: string
  nameEn: string
  /** Instrução prependida (PT). '' = sem efeito (estilo padrão). */
  prompt: string
  promptEn: string
}

export const OUTPUT_STYLES: OutputStyle[] = [
  {
    id: 'default',
    name: 'Padrão', nameEn: 'Default',
    prompt: '', promptEn: '',
  },
  {
    id: 'concise',
    name: 'Conciso', nameEn: 'Concise',
    prompt: 'ESTILO DE RESPOSTA: seja direto e enxuto. Vá ao ponto, sem preâmbulos nem repetição. Prefira frases curtas e listas a parágrafos longos. Não explique o que não foi pedido.',
    promptEn: 'RESPONSE STYLE: be direct and lean. Get to the point, no preamble or repetition. Prefer short sentences and lists over long paragraphs. Do not explain what was not asked.',
  },
  {
    id: 'explanatory',
    name: 'Explicativo', nameEn: 'Explanatory',
    prompt: 'ESTILO DE RESPOSTA: explique o raciocínio e o "porquê" das decisões. Dê contexto, trade-offs e alternativas relevantes, de forma organizada (seções/listas). Continue resolvendo a tarefa — a explicação acompanha, não substitui.',
    promptEn: 'RESPONSE STYLE: explain your reasoning and the "why" behind decisions. Give context, trade-offs, and relevant alternatives, organized (sections/lists). Keep solving the task — the explanation accompanies, not replaces.',
  },
  {
    id: 'learning',
    name: 'Ensino', nameEn: 'Learning',
    prompt: 'ESTILO DE RESPOSTA (ENSINO): aja como um mentor. Explique os conceitos à medida que avança e, quando fizer sentido, deixe pequenas lacunas marcadas com "TODO(você):" para o usuário completar e aprender fazendo. Equilibre entregar o resultado com ensinar o caminho.',
    promptEn: 'RESPONSE STYLE (LEARNING): act as a mentor. Explain concepts as you go and, where it makes sense, leave small gaps marked "TODO(you):" for the user to complete and learn by doing. Balance delivering the result with teaching the path.',
  },
  {
    id: 'code',
    name: 'Só código', nameEn: 'Code-only',
    prompt: 'ESTILO DE RESPOSTA: responda com CÓDIGO e o mínimo de prosa. Mostre o(s) bloco(s) de código necessários e, no máximo, uma ou duas linhas de contexto. Sem introduções nem conclusões.',
    promptEn: 'RESPONSE STYLE: answer with CODE and minimal prose. Show the necessary code block(s) and at most one or two lines of context. No intros or conclusions.',
  },
]

/** Resolve a instrução de um estilo pelo id e idioma. Id desconhecido/'default'
 *  → '' (sem efeito). Pura/testável. */
export function outputStyleAddition(styleId: string | undefined, lang: string): string {
  const style = OUTPUT_STYLES.find((s) => s.id === styleId)
  if (!style || style.id === 'default') return ''
  return lang === 'en' ? style.promptEn : style.prompt
}
