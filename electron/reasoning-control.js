// ─── Controle de esforço de raciocínio por provider (v2.25.0) ───────
//
// Mapeia UMA configuração do usuário (`reasoningEffort`) para os parâmetros de
// request que controlam quanto o modelo "pensa". A realidade é específica por
// provider (verificado na referência oficial da Claude API, 2026):
//   - modal / GLM (vLLM, OpenAI-compat): BINÁRIO via chat_template_kwargs.enable_thinking
//   - ollama: BINÁRIO via `think` (melhor-esforço no endpoint OpenAI-compat)
//   - openai (o-series / gpt-5): reasoning_effort low|medium|high
//   - anthropic: DEPENDE da geração do modelo (ver anthropicModelInfo):
//       • Opus 4.5+/Sonnet 4.6/Fable 5 → adaptive thinking + output_config.effort
//         (low|medium|high|xhigh|max). `budget_tokens` e sampling params (em
//         4.7/4.8/Fable) retornam HTTP 400 nesses modelos.
//       • Gerações antigas (Sonnet 4.5 / Opus 4.1·4.0 / 3.x) → extended thinking
//         via thinking.budget_tokens (e a temperatura PRECISA sair).
//   - openrouter / custom: reasoning_effort (passthrough, melhor-esforço)
//
// SEGURANÇA: 'default' (o padrão) NÃO envia esforço — preserva o comportamento.
// MAS a temperatura para modelos Anthropic que a rejeitam (Opus 4.7/4.8/Fable)
// é removida no main.js INDEPENDENTE do esforço (ver anthropicAcceptsTemperature),
// senão a requisição falharia já no default.

const ANTHROPIC_BUDGET = { low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 32768 }

// Níveis de effort aceitos pela Anthropic moderna (output_config.effort).
const ANTHROPIC_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
// OpenAI-compat (reasoning_effort) só conhece low|medium|high — xhigh/max caem em high.
function clampOpenAiEffort(e) {
  return (e === 'xhigh' || e === 'max') ? 'high' : e
}

/**
 * Classifica a geração de um modelo Anthropic (cruzado com a referência oficial):
 *  - effortGen: usa output_config.effort + adaptive thinking e REJEITA
 *    budget_tokens (Opus 4.5/4.6/4.7/4.8, Sonnet 4.6, Fable/Mythos 5).
 *  - noSampling: subconjunto que TAMBÉM rejeita temperature/top_p/top_k
 *    (Opus 4.7/4.8, Fable/Mythos 5).
 */
function anthropicModelInfo(model) {
  const m = String(model || '').toLowerCase()
  const noSampling = /opus-4-[78]|fable-5|mythos/.test(m)
  const effortGen = noSampling || /opus-4-[56]|sonnet-4-6/.test(m)
  return { effortGen, noSampling }
}

/** True quando o modelo Anthropic ainda aceita `temperature` (gerações ≤ 4.6). */
function anthropicAcceptsTemperature(model) {
  return !anthropicModelInfo(model).noSampling
}

/** Devolve { extra, dropTemperature, minMaxTokens } para mesclar no corpo.
 *  - extra: campos a adicionar ao body do request
 *  - dropTemperature: remover `temperature` do body
 *  - minMaxTokens: max_tokens mínimo (Anthropic legado: budget < max_tokens) */
function reasoningRequestParams(provider, model, effort) {
  const none = { extra: {}, dropTemperature: false, minMaxTokens: 0 }
  if (!effort || effort === 'default') return none
  // Rede de segurança (v2.50.0): 'auto' deve ser resolvido para um nível
  // concreto no renderer (ver utils/adaptiveEffort). Se vazar até aqui, trata
  // como 'medium' em vez de cair no default silencioso.
  if (effort === 'auto') effort = 'medium'
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
      return on ? { extra: { reasoning_effort: clampOpenAiEffort(effort) }, dropTemperature: false, minMaxTokens: 0 } : none
    case 'anthropic': {
      const info = anthropicModelInfo(model)
      if (info.effortGen) {
        // Geração moderna: adaptive thinking + output_config.effort. NUNCA
        // budget_tokens (400 nos mais novos). Sampling param já é removido p/
        // 4.7/4.8/Fable (noSampling) e, por conservadorismo, sempre que ligamos
        // o thinking (adaptive prefere amostragem padrão).
        const extra = {}
        if (on) {
          const lvl = ANTHROPIC_EFFORT_LEVELS.includes(effort) ? effort : 'high'
          // display:'summarized' devolve um RESUMO legível do raciocínio (o
          // default 'omitted' deixa o campo vazio = pausa silenciosa). Sem custo
          // extra; nosso bloco "Raciocínio" passa a mostrá-lo (transparência).
          extra.thinking = { type: 'adaptive', display: 'summarized' }
          extra.output_config = { effort: lvl }
        }
        return { extra, dropTemperature: info.noSampling || on, minMaxTokens: 0 }
      }
      // Geração legada: extended thinking com budget (incompatível com temperature).
      if (!on) return none
      const budget = ANTHROPIC_BUDGET[effort] || ANTHROPIC_BUDGET.medium
      return { extra: { thinking: { type: 'enabled', budget_tokens: budget } }, dropTemperature: true, minMaxTokens: budget + 2048 }
    }
    case 'openrouter':
    case 'custom':
      return on ? { extra: { reasoning_effort: clampOpenAiEffort(effort) }, dropTemperature: false, minMaxTokens: 0 } : none
    default:
      return none
  }
}

module.exports = { reasoningRequestParams, ANTHROPIC_BUDGET, anthropicModelInfo, anthropicAcceptsTemperature }
