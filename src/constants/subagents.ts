// ─── Subagents nomeados (v2.39.0) ───────────────────────────────────
//
// O Claude Code tem subagents com PAPÉIS especializados (Explore, Plan,
// code-reviewer…), cada um com seu system prompt. Aqui damos isso ao
// delegate_subtasks: cada subtarefa pode escolher um `agent` (papel), que
// prepende um system prompt especializado — em vez de todas serem genéricas.
// Mantido como dado puro + um resolvedor testável.

export interface SubagentRole {
  id: string
  name: string
  /** Mostrado na descrição da tool para o modelo escolher. */
  description: string
  /** System prompt prependido à subtarefa. */
  systemPrompt: string
}

export const SUBAGENT_ROLES: SubagentRole[] = [
  {
    id: 'explorer',
    name: 'Explorador',
    description: 'busca/leitura ampla no código ou na web; devolve a conclusão, não despeja arquivos',
    systemPrompt: 'Você é um subagente EXPLORADOR. Sua tarefa é investigar e localizar (no código ou na web) e devolver uma SÍNTESE objetiva — caminhos de arquivo, trechos-chave, nomes e a conclusão. NÃO edite nada. Seja conciso: entregue o achado, não o processo.',
  },
  {
    id: 'planner',
    name: 'Planejador',
    description: 'desenha um plano de implementação passo a passo com trade-offs, sem codar',
    systemPrompt: 'Você é um subagente PLANEJADOR. Produza um plano de implementação claro e enxuto: passos ordenados, arquivos/áreas afetados, riscos e trade-offs, e como verificar. NÃO escreva o código final — entregue o plano para outro agente executar.',
  },
  {
    id: 'reviewer',
    name: 'Revisor',
    description: 'revisa código/diff em busca de bugs, segurança e simplificação',
    systemPrompt: 'Você é um subagente REVISOR. Analise o código/diff em busca de correção, bugs, riscos de segurança (entrada validada, segredos, injeção) e simplificações. Classifique os achados por severidade (BLOQUEADOR > CRÍTICO > MAIOR > nit) com arquivo:linha e a correção sugerida. Seja específico e direto.',
  },
  {
    id: 'general',
    name: 'Geral',
    description: 'tarefa genérica (padrão quando nenhum papel é informado)',
    systemPrompt: '',
  },
]

/** Resolve o system prompt de um papel pelo id (case-insensitive). Papel
 *  desconhecido ou vazio → '' (comportamento genérico, sem prepend). */
export function resolveSubagentPrompt(agentId: string | undefined): string {
  if (!agentId) return ''
  const role = SUBAGENT_ROLES.find(r => r.id.toLowerCase() === String(agentId).trim().toLowerCase())
  return role?.systemPrompt || ''
}

/** Linha pronta para a descrição da tool, listando os papéis disponíveis. */
export function subagentRolesHint(): string {
  return SUBAGENT_ROLES.map(r => `${r.id} (${r.description})`).join('; ')
}
