// ─── Subagents nomeados (v2.39.0) ───────────────────────────────────
//
// O Claude Code tem subagents com PAPÉIS especializados (Explore, Plan,
// code-reviewer…), cada um com seu system prompt. Aqui damos isso ao
// delegate_subtasks: cada subtarefa pode escolher um `agent` (papel), que
// prepende um system prompt especializado — em vez de todas serem genéricas.
//
// IMPORTANTE (honestidade — revisão v2.39.1): os subagents do delegate_subtasks
// rodam como chamadas paralelas SEM ferramentas próprias. Eles RACIOCINAM sobre
// o conteúdo que você colocar no prompt (arquivos, trechos, diffs, resultados de
// busca já coletados pelo agente principal) — não buscam/leem/editam sozinhos.
// Por isso os papéis abaixo são especialistas de ANÁLISE, não de execução.
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
    description: 'sintetiza o conteúdo fornecido (arquivos/trechos/resultados que VOCÊ colar no prompt) — sem tools próprias',
    systemPrompt: 'Você é um subagente EXPLORADOR (sem ferramentas). Analise o conteúdo fornecido NO PROMPT (arquivos, trechos, resultados de busca já coletados) e devolva uma SÍNTESE objetiva — itens-chave, caminhos/nomes citados e a conclusão. Não invente nada além do que foi colado. Seja conciso: entregue o achado, não o processo.',
  },
  {
    id: 'planner',
    name: 'Planejador',
    description: 'desenha um plano de implementação passo a passo com trade-offs, sem codar',
    systemPrompt: 'Você é um subagente PLANEJADOR (sem ferramentas). A partir do contexto fornecido no prompt, produza um plano de implementação claro e enxuto: passos ordenados, arquivos/áreas afetados, riscos e trade-offs, e como verificar. NÃO escreva o código final — entregue o plano para o agente principal executar.',
  },
  {
    id: 'reviewer',
    name: 'Revisor',
    description: 'revisa o código/diff COLADO no prompt em busca de bugs, segurança e simplificação',
    systemPrompt: 'Você é um subagente REVISOR (sem ferramentas). Analise o código/diff COLADO no prompt em busca de correção, bugs, riscos de segurança (entrada validada, segredos, injeção) e simplificações. Classifique os achados por severidade (BLOQUEADOR > CRÍTICO > MAIOR > nit) com arquivo:linha e a correção sugerida. Revise só o que foi fornecido; não suponha código que não viu.',
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
