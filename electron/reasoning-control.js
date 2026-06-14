// ─── Controle de esforço de raciocínio por provider (v2.25.0) ───────
//
// Mapeia UMA configuração do usuário (`reasoningEffort`) para os parâmetros de
// request que controlam quanto o modelo "pensa". A realidade é específica por
// provider (verificado em 2026):
//   - modal / GLM (vLLM, OpenAI-compat): BINÁRIO via chat_template_kwargs.enable_thinking
//   - ollama: BINÁRIO via `think` (melhor-esforço no endpoint OpenAI-compat)
//   - openai (o-series / gpt-5): reasoning_effort low|medium|high
//   - anthropic: thinking.budget_tokens (e a temperatura PRECISA sair)
//   - openrouter / custom: reasoning_effort (passthrough, melhor-esforço)
//
// SEGURANÇA: 'default' (o padrão) NÃO envia nada — preserva o comportamento
// atual e não pode quebrar nenhum provider. O usuário escolhe desligar/ajustar.

const ANTHROPIC_BUDGET = { low: 2048, medium: 8192, high: 16384 }

/** Devolve { extra, dropTemperature, minMaxTokens } para mesclar no corpo.
 *  - extra: campos a adicionar ao body do request
 *  - dropTemperature: remover `temperature` (Anthropic com thinking exige)
 *  - minMaxTokens: max_tokens mínimo (Anthropic: budget < max_tokens) */
function reasoningRequestParams(provider, model, effort) {
  const none = { extra: {}, dropTemperature: false, minMaxTokens: 0 }
  if (!effort || effort === 'default') return none
  const on = effort !== 'off'

  switch (provider) {
    case 'modal':
      // GLM/vLLM: liga/desliga o thinking (profundidade não é controlável).
      return { extra: { chat_template_kwargs: { enable_thinking: on } }, dropTemperature: false, minMaxTokens: 0 }
    case 'ollama':
      // Endpoint OpenAI-compat do Ollama: `think` é melhor-esforço (ignorado se
      // o servidor não suportar — sem erro). Binário.
      return { extra: { think: on }, dropTemperature: false, minMaxTokens: 0 }
    case 'openai':
      // reasoning_effort só vale para modelos de raciocínio; só enviamos quando ON.
      return on ? { extra: { reasoning_effort: effort }, dropTemperature: false, minMaxTokens: 0 } : none
    case 'anthropic': {
      if (!on) return none // ausência do bloco thinking = pensamento desligado
      const budget = ANTHROPIC_BUDGET[effort] || ANTHROPIC_BUDGET.medium
      // thinking é incompatível com temperature; e budget < max_tokens.
      return { extra: { thinking: { type: 'enabled', budget_tokens: budget } }, dropTemperature: true, minMaxTokens: budget + 2048 }
    }
    case 'openrouter':
    case 'custom':
      return on ? { extra: { reasoning_effort: effort }, dropTemperature: false, minMaxTokens: 0 } : none
    default:
      return none
  }
}

module.exports = { reasoningRequestParams, ANTHROPIC_BUDGET }
