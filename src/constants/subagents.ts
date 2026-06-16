// ─── Subagents nomeados (v2.39.0) ───────────────────────────────────
//
// O Claude Code tem subagents com PAPÉIS especializados (Explore, Plan,
// code-reviewer…), cada um com seu system prompt. Aqui damos isso ao
// delegate_subtasks: cada subtarefa pode escolher um `agent` (papel), que
// prepende um system prompt especializado — em vez de todas serem genéricas.
//
// ATUALIZAÇÃO (v2.63.0): os subagents do delegate_subtasks agora rodam seu
// PRÓPRIO loop de ferramentas de LEITURA/PESQUISA (web_search, fetch_url,
// read_file, search_files, list_directory) — eles buscam/leem sozinhos e
// devolvem uma síntese (não escrevem/editam/executam). Ver researchWorker.ts.
// Os papéis abaixo continuam sendo especialistas de ANÁLISE; o system prompt do
// papel é prependido ao do worker. Mantido como dado puro + resolvedor testável.

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
    description: 'busca e lê (web/arquivos) e sintetiza — ideal p/ investigar uma área ou descobrir onde algo está',
    systemPrompt: 'Você é um subagente EXPLORADOR. Use suas ferramentas de leitura (search_files/read_file/list_directory para código, web_search/fetch_url para a web) para investigar e devolva uma SÍNTESE objetiva — itens-chave, caminhos/fontes citados e a conclusão. Não invente nada além do que leu. Seja conciso: entregue o achado, não o processo.',
  },
  {
    id: 'planner',
    name: 'Planejador',
    description: 'pesquisa o necessário e desenha um plano de implementação passo a passo com trade-offs, sem codar',
    systemPrompt: 'Você é um subagente PLANEJADOR. Use suas ferramentas de leitura (read_file/search_files/list_directory, e web_search/fetch_url se útil) para entender o contexto e então produza um plano de implementação claro e enxuto: passos ordenados, arquivos/áreas afetados, riscos e trade-offs, e como verificar. NÃO escreva o código final — entregue o plano para o agente principal executar.',
  },
  {
    id: 'reviewer',
    name: 'Revisor',
    description: 'lê o código relevante e revisa em busca de bugs, segurança e simplificação',
    systemPrompt: 'Você é um subagente REVISOR. Use read_file/search_files para ler o código que precisa revisar (além do que foi colado no prompt) e analise correção, bugs, riscos de segurança (entrada validada, segredos, injeção) e simplificações. Classifique os achados por severidade (BLOQUEADOR > CRÍTICO > MAIOR > nit) com arquivo:linha e a correção sugerida. Baseie-se só no que efetivamente leu; não suponha código que não viu.',
  },
  {
    id: 'general',
    name: 'Geral',
    description: 'tarefa genérica de raciocínio (padrão quando nenhum papel é informado)',
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
