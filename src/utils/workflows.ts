// ─── Workflows no chat (fusão do WorkflowBuilder — v2.76.0) ─────────
//
// O WorkflowBuilder monta pipelines de nós (trigger/prompt/tool/condition/
// output) e os roda num painel. Aqui a capacidade vira a ferramenta
// run_workflow: a IA executa um workflow SALVO pelo nome (atalho determinístico
// vs. planejar do zero com plan_tasks/delegate_subtasks). Como um workflow pode
// rodar comandos / escrever arquivos, a ferramenta INTEIRA é gateada por
// aprovação (DANGEROUS_TOOLS) — uma aprovação para o workflow nomeado, que o
// próprio usuário criou. O painel segue para montar/editar.
//
// Helpers PUROS/testáveis: tipos, ordenação topológica (igual ao painel),
// achar por nome, router hint (lista workflows salvos) e formatar o log. A
// execução assíncrona (IPC) vive no useToolExecution.

export interface WfNode {
  id: string
  type: 'trigger' | 'prompt' | 'tool' | 'condition' | 'output'
  label: string
  config: Record<string, any>
}
export interface WfEdge { id: string; fromId: string; toId: string }
export interface Workflow {
  id: string
  name: string
  description?: string
  nodes: WfNode[]
  edges: WfEdge[]
}

/** Resumo leve p/ o router (sem os nós). */
export interface WorkflowSummary { name: string; description?: string }

/** Ordem topológica dos nós (mesmo algoritmo do painel: Kahn; nós restantes —
 *  ciclos/desconexos — caem fora, como no original que filtra Boolean). */
export function topoOrder(nodes: WfNode[], edges: WfEdge[]): WfNode[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []) }
  for (const e of edges || []) {
    if (!adj.has(e.fromId) || !inDegree.has(e.toId)) continue
    adj.get(e.fromId)!.push(e.toId)
    inDegree.set(e.toId, (inDegree.get(e.toId) ?? 0) + 1)
  }
  const queue = nodes.filter(n => inDegree.get(n.id) === 0)
  const result: WfNode[] = []
  while (queue.length > 0) {
    const n = queue.shift()!
    result.push(n)
    for (const nbr of adj.get(n.id) ?? []) {
      const d = (inDegree.get(nbr) ?? 1) - 1
      inDegree.set(nbr, d)
      if (d === 0) { const node = nodes.find(x => x.id === nbr); if (node) queue.push(node) }
    }
  }
  return result
}

/** Acha um workflow por id exato ou nome (case-insensitive, trim). */
export function findWorkflow(workflows: Workflow[] | undefined, nameOrId: string): Workflow | null {
  const q = (nameOrId || '').trim().toLowerCase()
  if (!q || !Array.isArray(workflows)) return null
  return (
    workflows.find(w => w && String(w.id).toLowerCase() === q) ||
    workflows.find(w => w && String(w.name || '').trim().toLowerCase() === q) ||
    null
  )
}

/** Router hint: lista os workflows salvos para a IA saber o que pode rodar.
 *  Vazio quando não há nenhum (a IA não menciona a ferramenta à toa). */
export function buildWorkflowRouterHint(workflows: WorkflowSummary[] | undefined, lang: string): string {
  const list = (workflows || []).filter(w => w && w.name)
  if (!list.length) return ''
  const items = list.slice(0, 12).map(w => `- ${w.name}${w.description ? `: ${w.description}` : ''}`)
  return (lang === 'en'
    ? ['[SAVED WORKFLOWS] The user has saved automation workflows. When the task matches one, call run_workflow with its name instead of planning from scratch (it needs approval before running):']
    : ['[WORKFLOWS SALVOS] O usuário tem workflows de automação salvos. Quando a tarefa casar com um, chame run_workflow com o nome dele em vez de planejar do zero (pede aprovação antes de rodar):']
  ).concat(items).join('\n')
}

export interface WfRunEntry { label: string; status: 'done' | 'error' | 'skipped'; output: string }

/** Formata o log de execução do workflow para a IA. */
export function formatWorkflowRun(name: string, entries: WfRunEntry[], finalOutput: string): string {
  const lines = entries.map(e => {
    const icon = e.status === 'done' ? '✓' : e.status === 'skipped' ? '⤳' : '✕'
    const out = (e.output || '').trim()
    return `${icon} ${e.label}${out ? `: ${out.length > 300 ? out.slice(0, 300) + '…' : out}` : ''}`
  })
  return [
    `Workflow "${name}" executado (${entries.length} passo(s)):`,
    ...lines,
    '',
    `Saída final:\n${(finalOutput || '').trim() || '(vazia)'}`,
  ].join('\n')
}
