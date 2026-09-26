export interface SubagentRole {
  id: string
  name: string
  description: string
  systemPrompt: string
}

export const SUBAGENT_ROLES: SubagentRole[] = [
  {
    id: 'explorer',
    name: 'Explorador',
    description: 'busca e lê (web/arquivos) e sintetiza — ideal p/ investigar uma área ou descobrir onde algo está',
    systemPrompt: `<system_prompt>
  <role>Você é o subagente EXPLORADOR.</role>
  <mission>Investigar usando ferramentas de leitura (search_files/read_file/list_directory, web_search/fetch_url) e devolver uma SÍNTESE puramente objetiva.</mission>
  <rules>
    <rule>Vá direto aos itens-chave, caminhos/fontes citados e a conclusão. Zero introduções (nunca diga "Aqui está o que encontrei").</rule>
    <rule>Baseie-se ESTRITAMENTE no que leu. Não assuma, não invente e não presuma nada além do texto bruto.</rule>
    <rule>Entregue o achado, não narre o processo de busca.</rule>
  </rules>
</system_prompt>`,
  },
  {
    id: 'planner',
    name: 'Planejador',
    description: 'pesquisa o necessário e desenha um plano de implementação passo a passo com trade-offs, sem codar',
    systemPrompt: `<system_prompt>
  <role>Você é o subagente PLANEJADOR.</role>
  <mission>Entender o contexto via ferramentas de leitura e produzir um plano de implementação técnico, claro e enxuto.</mission>
  <rules>
    <rule>O plano DEVE conter: passos ordenados, arquivos/áreas afetados, riscos/trade-offs e critério de verificação.</rule>
    <rule>NÃO escreva o código final. Sua saída é a rota para o agente principal executar.</rule>
    <rule>Zero meta-comentários. Inicie a resposta diretamente no passo 1 do plano.</rule>
  </rules>
</system_prompt>`,
  },
  {
    id: 'reviewer',
    name: 'Revisor',
    description: 'lê o código relevante e revisa em busca de bugs, segurança e simplificação',
    systemPrompt: `<system_prompt>
  <role>Você é o subagente REVISOR.</role>
  <mission>Auditar o código com foco em correção, bugs, riscos de segurança (injeção, vazamento de segredos, validação) e simplificação.</mission>
  <rules>
    <rule>Classifique os achados por severidade (BLOQUEADOR > CRÍTICO > MAIOR > nit).</rule>
    <rule>Aponte o caminho exato no formato arquivo:linha e a correção sugerida.</rule>
    <rule>Audite SOMENTE o que efetivamente leu. Não critique ou suponha falhas em códigos ou arquivos que não visualizou via ferramentas.</rule>
    <rule>Entregue a auditoria diretamente. Sem saudações ou introduções.</rule>
  </rules>
</system_prompt>`,
  },
  {
    id: 'general',
    name: 'Geral',
    description: 'tarefa genérica de raciocínio (sem método próprio — omitir o papel é melhor: aí o método é inferido da subtarefa)',
    systemPrompt: '',
  },
]

export function subagentRolesHint(): string {
  return SUBAGENT_ROLES.map(r => `"${r.id}" (${r.description})`).join(', ')
}

/** Infere o papel pelo texto da subtarefa quando a IA omite (ou erra) o
 *  `agent`. A maioria das subtarefas delegadas é investigativa, então o padrão
 *  é o explorer — nunca "sem método". */
export function autoInferSubagentRole(promptText: string): string {
  const p = (promptText || '').toLowerCase()
  if (/\b(erro|error|bug|exception|security|seguran[çc]a|revis\w*|review|vulnerab\w*|audit|falha)\b/.test(p)) {
    return 'reviewer'
  }
  if (/\b(plano|plan\w*|estrateg\w*|passo a passo|arquitet\w*|design|trade-off|passos)\b/.test(p)) {
    return 'planner'
  }
  return 'explorer'
}

/** Resolve o system prompt de um papel (case-insensitive). Se o id não resolver
 *  para um papel COM prompt — omitido, desconhecido ("researcher",
 *  "Explorador") ou o `general`, que não tem método próprio — infere pelo texto
 *  da subtarefa.
 *
 *  RESTAURADO (v2.213.0): o commit 94954b8 reconstruiu este arquivo a partir da
 *  versão original e, no caminho, apagou `autoInferSubagentRole` e passou a
 *  IGNORAR `fallbackPrompt` — mantendo o parâmetro na assinatura, então o tsc
 *  seguiu verde e a chamada em useToolExecution continuou compilando. Resultado:
 *  toda subtarefa sem papel explícito voltava a rodar SEM instrução de método,
 *  e a busca virou case-sensitive ('REVIEWER' dava vazio). Os testes em
 *  subagents.test.ts e scoutQuality.test.ts existem para barrar exatamente isso. */
export function resolveSubagentPrompt(roleId?: string, fallbackPrompt?: string): string {
  const asked = roleId ? String(roleId).trim().toLowerCase() : ''
  const direct = asked ? SUBAGENT_ROLES.find(r => r.id.toLowerCase() === asked) : undefined
  if (direct?.systemPrompt) return direct.systemPrompt
  const inferred = SUBAGENT_ROLES.find(r => r.id === autoInferSubagentRole(fallbackPrompt || ''))
  return inferred?.systemPrompt || ''
}