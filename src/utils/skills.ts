// ─── Skills — helpers puros (v2.27.0) ───────────────────────────────
//
// Montagem do manifesto/instruções e lookup. Tudo puro e testável; a UI e o
// useChat só consomem. Ver types/skill.ts para o modelo.

import type { Skill } from '../types/skill'

/** Skills de fábrica — exemplos úteis e editáveis. */
export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'builtin-code-review',
    name: 'code',
    description: 'Implementar/corrigir código com disciplina: entender, planejar, mudança mínima, verificar e auto-revisar.',
    instructions: `Ciclo de coding de alto nível (uma tarefa por vez):

1. ENTENDER antes de tocar. Use search_files para achar definições/usos e read_file no arquivo-alvo e vizinhos; absorva as convenções existentes. Nunca edite às cegas. Carregue só o trecho necessário (alto sinal), não o codebase inteiro.

2. PLANEJAR. Para tarefa com mais de 1-2 passos, registre o plano com plan_tasks (inclua uma tarefa 'Verificar') e marque progresso com update_task_status. Pense em trade-offs, edge cases e blast radius. Não code se o escopo estiver vago.

3. REPRODUZIR. Confirme o bug/requisito ANTES de corrigir: rode o caso que falha via execute_command ou escreva um teste que falhe agora e passe depois. Sem repro, você corrige no escuro.

4. MUDANÇA MÍNIMA E CIRÚRGICA. A menor alteração que resolve. Prefira SEMPRE edit_file (diff localizado) a write_file (reescreve o arquivo inteiro). Não reformate, não renomeie nem 'melhore de passagem' (anti over-engineering). Se um write der errado, use undo_last_write.

5. VERIFICAR com ground truth. Rode build/lint/testes via execute_command e leia a saída de verdade. Confirme que o repro passou E que nenhuma regressão surgiu. Para UI/comportamento, teste o fluxo real.

6. DISCIPLINA EM ERROS. Leia a mensagem completa; corrija a causa raiz, não o sintoma. Se edit_file falhar (string não encontrada), re-leia o arquivo (o estado mudou) em vez de repetir. Após 2-3 tentativas sem progresso, reavalie a hipótese — não entre em loop.

7. AUTO-REVISAR antes de entregar. Releia o diff (git_command 'diff'). Cheque correção, segurança (entrada validada, segredos, PII em log), legibilidade e nomes; remova código morto e debug. Classifique achados: BLOQUEADOR > CRÍTICO > MAIOR > nit. Guarde estado da tarefa em update_working_memory; comandos de build/test estáveis em remember_fact.`,
    triggers: ['implementar', 'corrigir', 'bug', 'código', 'coding', 'refatorar', 'feature', 'code', 'fix', 'consertar'],
    enabled: true,
    pinned: false,
    isBuiltIn: true,
    createdAt: 0,
  },
  {
    id: 'builtin-cite-sources',
    name: 'pesquisa-com-fontes',
    description: 'Pesquisar com busca eficiente, triangular fontes e responder citando URLs reais, sem alucinar.',
    instructions: `Pesquisa robusta — do amplo ao específico, com citação verificável:

1. DECOMPOR E CALIBRAR. Quebre a pergunta em 3-5 subperguntas; registre com plan_tasks. Escale o esforço à dificuldade: fato simples = 1-2 buscas; tema complexo = várias linhas. Não subdivida pergunta trivial.

2. BUSCAR EM LEQUE, COM PARCIMÔNIA. Use web_search com consultas ESPECÍFICAS e VARIADAS (termos exatos, nomes, datas) — não reformulações da mesma (queries idênticas vêm do cache de 5min e não trazem nada novo). Comece largo, depois estreite. Pare quando novas buscas só repetem o que já tem ou a afirmação já está triangulada.

3. CITAR A PARTIR DOS RESULTADOS. web_search já devolve título, trecho e URL — suficiente para citar sem abrir cada link. Só escale para browser_navigate + browser_get_text quando a afirmação for load-bearing, o trecho for ambíguo ou você precisar da fonte primária (paper, doc oficial, dado bruto).

4. AVALIAR A FONTE. Cheque autor, data e viés. Prefira fontes autoritativas a content-farms/SEO — o ranking do buscador não é prova.

5. TRIANGULAR. Só afirme o que for confirmado por 2-3 fontes INDEPENDENTES (não cópias da mesma origem). Se as fontes divergem, reporte a divergência em vez de escolher uma em silêncio.

6. VERIFICAR ADVERSARIALMENTE. Após rascunhar conclusões, gere perguntas contra suas próprias afirmações e busque contra-evidência; revise a conclusão se ela não se sustentar.

7. CITAR (anti-alucinação) — passada SEPARADA. Ao final, ligue cada afirmação não-trivial à URL/trecho realmente consultado, em 'Fontes:'. Sem fonte = não afirme (marque incerto ou omita). Nunca invente URLs, números, datas ou citações. Separe fato citado de inferência sua (rotulada).

8. PERSISTIR. Guarde achados duráveis e fontes-chave com remember_fact; estado da investigação em andamento com update_working_memory.`,
    triggers: ['pesquise', 'pesquisar', 'pesquisa', 'fontes', 'cite', 'busque na web', 'investigar', 'fact-check', 'verificar fonte'],
    enabled: true,
    pinned: false,
    isBuiltIn: true,
    createdAt: 0,
  },
  {
    id: 'builtin-commit-pr',
    name: 'commit-e-pr',
    description: 'Padrão de commit/PR deste projeto (branch, mensagem, rebuild, push).',
    instructions: [
      'Fluxo de entrega deste projeto:',
      '1. Trabalhe na raiz local; crie uma branch por ciclo (cycle/<tema>).',
      '2. Commit com título "vX.Y.Z — descrição"; mensagens em português.',
      '3. Rode os testes e o typecheck antes de finalizar.',
      '4. Reconstrua o instalador em release/ quando aplicável.',
      '5. ff-only na master e git push origin master (toda atualização é enviada).',
    ].join('\n'),
    triggers: ['commit', 'pr', 'release', 'push', 'publicar'],
    enabled: false,
    pinned: false,
    isBuiltIn: true,
    createdAt: 0,
  },
  {
    id: 'builtin-pentest',
    name: 'pentest',
    description: 'Pentest ÉTICO com escopo autorizado: recon → enumeração → análise de vulnerabilidades → PoC controlada → relatório com remediação.',
    instructions: `Ciclo de penetration testing ÉTICO — só com autorização explícita do dono do sistema:

0. AUTORIZAÇÃO E ESCOPO — pré-requisito inegociável, antes de QUALQUER ação. Confirme: existe autorização (do dono/contrato/CTF/lab próprio)? Quais alvos (IPs/domínios/apps) estão NO escopo e quais ficam DE FORA? Qual a janela de tempo e as regras de engajamento (rate-limit, proibido DoS, proibido exfiltrar dados reais)? Sem escopo claro e autorizado, PARE e pergunte — nunca teste sistema de terceiros sem permissão. Guarde o escopo com remember_fact.

1. RECON. Mapeie a superfície de ataque DENTRO do escopo: passivo primeiro (OSINT, web_search por exposições/credenciais vazadas/subdomínios, DNS), depois ativo. Use execute_command só para ferramentas locais autorizadas. Registre o plano com plan_tasks (inclua uma tarefa 'Relatório') e marque progresso com update_task_status.

2. ENUMERAÇÃO. Aprofunde nos serviços/portas/endpoints/parâmetros achados: versões exatas, tecnologias, usuários, configs e segredos expostos. Para código/config no repo, use search_files + read_file. Catalogue cada achado com a evidência bruta (saída do comando, request/response).

3. ANÁLISE DE VULNERABILIDADES. Cruze os achados com OWASP Top 10 / CWE e CVEs conhecidos (web_search pela versão EXATA do componente). Separe vuln confirmada de hipótese. Classifique por severidade (Crítica/Alta/Média/Baixa) via impacto × probabilidade — use CVSS quando aplicável.

4. PoC CONTROLADA — só dentro do escopo e das regras. Prove a vulnerabilidade com o MENOR teste que demonstra o risco: nada destrutivo, sem tocar dados reais, sem pivotar para fora do escopo, sem persistir acesso. Documente os passos exatos de reprodução. Em dúvida sobre o blast radius, pare e confirme ANTES.

5. VERIFICAR — sem falso positivo. Todo achado reportado precisa de evidência reproduzível. Verifique adversarialmente: tente refutar o próprio achado (é explorável de verdade? há mitigação ativa?) antes de afirmá-lo. Sem evidência sólida = não reporte como confirmado (marque 'a investigar').

6. RELATÓRIO E REMEDIAÇÃO. Para cada achado: título, severidade, evidência/PoC, impacto e remediação CONCRETA (com código/config quando der). Ordene por severidade e abra com um resumo executivo. Recomende defesa em profundidade, não só o patch pontual. Pratique disclosure responsável.

7. PERSISTIR E LIMPAR. Guarde achados duráveis com remember_fact e o estado da investigação com update_working_memory. Reverta qualquer artefato de teste (arquivo, conta, payload) que tenha criado no alvo.`,
    triggers: ['pentest', 'penetration', 'pentesting', 'vulnerabilidade', 'vulnerabilidades', 'owasp', 'red team', 'exploit', 'cve', 'recon', 'enumeração', 'segurança ofensiva'],
    enabled: true,
    pinned: false,
    isBuiltIn: true,
    createdAt: 0,
  },
]

/** Lookup por nome (case-insensitive) ou id. Null se não achar. */
export function findSkill(skills: Skill[], nameOrId: string): Skill | null {
  if (!nameOrId) return null
  const q = nameOrId.trim().toLowerCase()
  return skills.find(s => s.name.toLowerCase() === q || s.id.toLowerCase() === q) || null
}

/** Manifesto compacto (nome: descrição) das skills ATIVAS e NÃO fixadas — é o
 *  bloco barato que vai no system prompt instruindo o modelo a chamar
 *  load_skill quando relevante. '' se não houver nenhuma. */
export function renderSkillManifest(skills: Skill[]): string {
  const avail = skills.filter(s => s.enabled && !s.pinned)
  if (avail.length === 0) return ''
  const lines = avail.map(s => `- ${s.name}: ${s.description}`)
  return [
    '[SKILLS DISPONÍVEIS] Quando uma destas capacidades for relevante para a tarefa, chame a ferramenta load_skill("nome") para obter as instruções completas ANTES de prosseguir. Não invente o conteúdo da skill.',
    ...lines,
  ].join('\n')
}

/** Instruções COMPLETAS das skills fixadas (pinned) + ativas — injetadas direto,
 *  sem depender do modelo chamar load_skill. '' se não houver. */
export function renderPinnedSkills(skills: Skill[]): string {
  const pinned = skills.filter(s => s.enabled && s.pinned)
  if (pinned.length === 0) return ''
  return pinned.map(s => `[SKILL ATIVA: ${s.name}]\n${s.instructions}`).join('\n\n')
}

/** Headers curtos para o painel de contexto (orçamento de tokens do slot
 *  "skills"): nome: desc das ativas. */
export function skillManifestHeaders(skills: Skill[]): string {
  return skills.filter(s => s.enabled).map(s => `${s.name}: ${s.description}`).join('\n')
}

/** Skills ATIVAS cujas palavras-gatilho aparecem no texto (Fase 3: auto-sugestão
 *  por palavra-chave). Não inclui as já fixadas (essas já entram inteiras). */
export function matchSkillsByText(skills: Skill[], text: string): Skill[] {
  const t = (text || '').toLowerCase()
  if (!t) return []
  return skills.filter(s =>
    s.enabled && !s.pinned &&
    Array.isArray(s.triggers) &&
    s.triggers.some(k => k && t.includes(k.toLowerCase())),
  )
}

/** Resultado da ferramenta load_skill: as instruções da skill, ou um erro
 *  acionável se o nome não existir. */
export function formatLoadSkillResult(skill: Skill | null, requestedName: string): string {
  if (!skill) {
    return `Erro: skill "${requestedName}" não encontrada. Verifique o nome exato no manifesto [SKILLS DISPONÍVEIS].`
  }
  if (!skill.enabled) {
    return `Erro: a skill "${skill.name}" está desativada.`
  }
  return `[SKILL: ${skill.name}]\n${skill.instructions}`
}

/** Mescla builtins com as skills salvas do usuário: builtins primeiro (com
 *  overrides do usuário aplicados por id), depois as criadas pelo usuário. */
export function mergeSkills(saved: Skill[] | null | undefined): Skill[] {
  const userSkills = Array.isArray(saved) ? saved : []
  const byId = new Map(userSkills.map(s => [s.id, s]))
  const builtins = BUILTIN_SKILLS.map(b => byId.get(b.id) ? { ...b, ...byId.get(b.id)!, isBuiltIn: true } : b)
  const custom = userSkills.filter(s => !BUILTIN_SKILLS.some(b => b.id === s.id))
  return [...builtins, ...custom]
}
