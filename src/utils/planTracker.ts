// ─── Plan tracking — espelho local do plano de tarefas (puro) ───────
//
// O loop do chat (useChat) precisa saber, no FIM do turno, se o modelo encerrou
// com tarefas pendentes — o bug em que a IA entrega o relatório final mas o
// painel fica em "0/7" porque ela nunca chamou update_task_status. Em vez de ler
// o estado do React (assíncrono), espelhamos o plano a partir das próprias tool
// calls (plan_tasks / update_task_status), igual ao monitor de todos do Claude
// Agent SDK. Mantido puro e sem dependências para ser testável.

export interface LocalTask { id?: string; status: string }

/** Lê os argumentos de uma tool call (string JSON ou objeto), tolerante a erro. */
function readArgs(tc: any): any {
  const raw = tc?.function?.arguments
  if (raw == null) return {}
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

/** Aplica as tool calls plan_tasks / update_task_status ao espelho local do
 *  plano e devolve a nova lista de tarefas. plan_tasks substitui o plano;
 *  update_task_status atualiza o status da tarefa pelo task_id. */
export function applyPlanToolCalls(tasks: LocalTask[], calls: any[]): LocalTask[] {
  let next = tasks
  for (const tc of calls || []) {
    const fn = tc?.function?.name
    if (fn === 'plan_tasks') {
      const a = readArgs(tc)
      next = Array.isArray(a.tasks)
        ? a.tasks.map((t: any) => ({ id: t?.id, status: String(t?.status || 'pending') }))
        : []
    } else if (fn === 'update_task_status') {
      const a = readArgs(tc)
      if (a.task_id && a.status) {
        next = next.map(t => (t.id === a.task_id ? { ...t, status: String(a.status) } : t))
      }
    }
  }
  return next
}

/** True quando há ao menos uma tarefa que não está done nem failed (ou seja, o
 *  plano não foi concluído). Lista vazia = nada a concluir = false. */
export function planIsIncomplete(tasks: LocalTask[]): boolean {
  return tasks.length > 0 && tasks.some(t => t.status !== 'done' && t.status !== 'failed')
}
