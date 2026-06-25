// ─── Controle de uso de ferramentas (tool_choice, v2.141.0) ─────────
// Porting da referência da Anthropic: além de deixar o modelo decidir (auto),
// dá pra EXIGIR que ele use uma ferramenta ou PROIBIR o uso. Mapeia um modo
// normalizado para o formato de cada provider e resolve o modo efetivo por
// passo do loop do agente (evita o agente nunca terminar — ver abaixo).

export type ToolChoiceMode = 'auto' | 'require' | 'none'

/**
 * Parâmetro `tool_choice` no formato do provider, ou `undefined` para 'auto'
 * (omitir = comportamento padrão). Anthropic usa objetos {type}; OpenAI-compat
 * usa strings.
 */
export function toolChoiceParam(provider: string, mode: ToolChoiceMode): unknown {
  if (mode === 'auto') return undefined
  if (provider === 'anthropic') {
    return mode === 'require' ? { type: 'any' } : { type: 'none' }
  }
  // openai / openrouter / modal / custom / ollama (OpenAI-compat)
  return mode === 'require' ? 'required' : 'none'
}

/**
 * Modo efetivo para um passo do turno. 'require' SÓ vale no 1º passo (step 0):
 * forçar uma ferramenta em TODO passo impediria o agente de dar a resposta
 * final (ele seria obrigado a chamar ferramenta para sempre). 'none' vale em
 * todos os passos; 'auto' é sempre auto.
 */
export function resolveTurnToolChoice(mode: ToolChoiceMode | undefined, stepIndex: number): ToolChoiceMode {
  if (mode === 'none') return 'none'
  if (mode === 'require') return stepIndex === 0 ? 'require' : 'auto'
  return 'auto'
}

/** Rótulo curto para a UI. */
export function toolChoiceLabel(mode: ToolChoiceMode | undefined, lang: 'pt' | 'en'): string {
  switch (mode) {
    case 'require': return lang === 'en' ? 'Required' : 'Exigir'
    case 'none': return lang === 'en' ? 'No tools' : 'Sem ferr.'
    default: return lang === 'en' ? 'Auto' : 'Auto'
  }
}

/** Ciclo Auto → Exigir → Nenhuma → Auto (para o botão da UI). */
export function nextToolChoiceMode(mode: ToolChoiceMode | undefined): ToolChoiceMode {
  if (mode === 'require') return 'none'
  if (mode === 'none') return 'auto'
  return 'require'
}
