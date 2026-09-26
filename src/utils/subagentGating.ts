// ─── Subagent Effort Gating (Claude Ultracode style) ─────────────────
//
// Os subagentes de pesquisa (delegate_subtasks) devem ser ofertados ao modelo
// orquestrador APENAS quando o esforço de raciocínio estiver configurado para
// Alto/Ultracode ('high', 'xhigh', 'max' ou 'ultracode'). Nos níveis inferiores
// ('off', 'low', 'medium', 'default' não-alto), a ferramenta é removida de allTools,
// impedindo que a IA dispare subagentes desnecessariamente em tarefas simples.

/** Conjunto de níveis de esforço que habilitam a ferramenta delegate_subtasks. */
export const HIGH_EFFORT_LEVELS = new Set<string>(['high', 'xhigh', 'max', 'ultracode'])

/** Determina se a delegação via subagentes (delegate_subtasks) é permitida para o nível de esforço fornecido. */
export function isSubagentDelegationAllowed(effort: string | undefined): boolean {
  if (!effort) return false
  return HIGH_EFFORT_LEVELS.has(String(effort).toLowerCase().trim())
}
