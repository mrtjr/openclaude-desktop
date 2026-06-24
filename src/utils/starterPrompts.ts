// ─── Starter prompts no empty-state (v2.131.0) ──────────────────────
// Padrão ChatGPT/Perplexity/Claude: numa conversa em branco, oferecer alguns
// prompts prontos e clicáveis. Reduz a fricção da "página em branco" e mostra
// a variedade do que dá pra pedir (web, escrita, planejamento, código). Some
// assim que o usuário envia a primeira mensagem.
//
// Núcleo puro e testado; App renderiza os chips e dispara o envio ao clicar.

import type { Language } from '../types'

export interface StarterPrompt {
  emoji: string
  /** Rótulo curto exibido no chip. */
  label: string
  /** Texto completo, pronto para enviar (sem placeholders a preencher). */
  text: string
}

const PROMPTS: Record<Language, StarterPrompt[]> = {
  pt: [
    { emoji: '🔎', label: 'Pesquisar na web', text: 'Pesquise na web o que há de mais novo em inteligência artificial neste mês e me dê um resumo com as fontes.' },
    { emoji: '✍️', label: 'Escrever um e-mail', text: 'Escreva um e-mail profissional e cordial pedindo um retorno sobre uma proposta que enviei na semana passada.' },
    { emoji: '🗺️', label: 'Planejar a semana', text: 'Me ajude a planejar minha semana de trabalho: organize as prioridades em etapas acionáveis e sugira blocos de foco.' },
    { emoji: '🐍', label: 'Escrever código', text: 'Escreva uma função Python que leia um arquivo CSV e devolva a média de uma coluna, com tratamento de erros e um exemplo de uso.' },
  ],
  en: [
    { emoji: '🔎', label: 'Search the web', text: 'Search the web for the latest in artificial intelligence this month and give me a summary with the sources.' },
    { emoji: '✍️', label: 'Write an email', text: 'Write a professional, friendly email asking for feedback on a proposal I sent last week.' },
    { emoji: '🗺️', label: 'Plan my week', text: 'Help me plan my work week: organize priorities into actionable steps and suggest focus blocks.' },
    { emoji: '🐍', label: 'Write code', text: 'Write a Python function that reads a CSV file and returns the average of a column, with error handling and a usage example.' },
  ],
}

/** Os prompts iniciais para o idioma atual (cai no inglês se desconhecido). */
export function starterPrompts(lang: Language): StarterPrompt[] {
  return PROMPTS[lang] ?? PROMPTS.en
}
