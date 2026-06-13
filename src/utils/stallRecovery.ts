// ─── Recuperação de stream travado (stall) — v2.22.0 ────────────────
//
// O watchdog de conteúdo (electron/main.js) mata um stream que só manda
// keep-alive. Antes o turno morria; agora o passo é refeito do zero — seguro
// porque NADA parcial é commitado no erro (o commit só roda no sucesso), então
// não há texto duplicado nem tool-call com JSON truncado (o catch precede o
// processToolCalls). Ver design validado no ciclo v2.22.0.
//
// Orçamento: 1 retry POR PASSO, com um teto POR TURNO. O cap por-passo evita
// re-cobrar o mesmo passo em loop; o teto por-turno evita gasto descontrolado
// mas — diferente de um cap único por turno — deixa um run agêntico longo
// sobreviver a stalls isolados em passos diferentes (o pior caso do GLM/Modal).
//
// IMPORTANTE: este contador é o ÚNICO guard de término do stall. O safetyLimit
// global NÃO ajuda aqui porque o retry faz steps-- (rebobina o passo), então
// steps nunca avança em direção ao limite por causa de stalls.

export interface StallRetryState {
  /** Passo em que o último stall-retry ocorreu (identidade do passo). */
  lastStep: number
  /** Retries de stall já gastos no passo atual. */
  perStep: number
  /** Retries de stall já gastos no turno inteiro. */
  perTurn: number
}

export interface StallLimits {
  perStep: number
  perTurn: number
}

export const STALL_LIMITS: StallLimits = { perStep: 1, perTurn: 3 }

export function initStallState(): StallRetryState {
  return { lastStep: -1, perStep: 0, perTurn: 0 }
}

/** Decide se um stall no `step` atual pode ser refeito, e devolve o novo
 *  estado. Puro: o estado entra e sai, sem efeitos colaterais. Quando o passo
 *  muda, o contador por-passo zera (cada passo tem seu próprio orçamento). */
export function decideStallRetry(
  state: StallRetryState,
  step: number,
  limits: StallLimits = STALL_LIMITS,
): { retry: boolean; state: StallRetryState } {
  // Passo novo → zera o contador por-passo (mantém o por-turno acumulado).
  const perStep = state.lastStep === step ? state.perStep : 0
  if (perStep < limits.perStep && state.perTurn < limits.perTurn) {
    return { retry: true, state: { lastStep: step, perStep: perStep + 1, perTurn: state.perTurn + 1 } }
  }
  // Sem orçamento: registra a tentativa neste passo mas não refaz.
  return { retry: false, state: { lastStep: step, perStep, perTurn: state.perTurn } }
}
