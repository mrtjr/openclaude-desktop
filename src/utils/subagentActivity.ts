// ─── Atividade ao vivo dos subagentes (v2.66.0) ─────────────────────
//
// Torna VISÍVEL o que o Claude mostra: cada subagente do delegate_subtasks
// aparece, mostra que recebeu a ordem, o que está fazendo (passos/ferramentas) e
// o que entregou. Store observável (useSyncExternalStore no App); useToolExecution
// escreve as transições conforme os workers rodam. A lógica é testável.

export type SubagentStatus = 'working' | 'done' | 'error'

export interface SubagentRun {
  /** Id único do worker nesta sessão (gerado em useToolExecution). */
  id: string
  /** A ordem recebida (prompt da subtarefa, truncado para exibição). */
  task: string
  /** Modelo Ollama/Modal que está executando este worker. */
  model: string
  status: SubagentStatus
  /** Passos do loop já dados. */
  steps: number
  /** Última ferramenta que o worker chamou (p/ o status "trabalhando em…"). */
  lastTool?: string
  /** Todas as ferramentas usadas (com repetição). */
  toolsUsed: string[]
  /** Síntese final (quando done) ou mensagem de erro (quando error). */
  result?: string
  startedAt: number
  endedAt?: number
  /** Profundidade na árvore de subagentes (v2.88.0): 1 = worker direto do
   *  orquestrador; 2+ = sub-worker aninhado. Usado p/ indentar no painel. */
  depth?: number
  /** Id do worker pai (quando aninhado) — fecha a árvore no painel. */
  parentId?: string
}

type Listener = () => void

/** Store observável das execuções de subagente. getSnapshot devolve a MESMA
 *  referência entre mutações (requisito do useSyncExternalStore). */
export class SubagentActivityStore {
  private runs: SubagentRun[] = []
  private listeners = new Set<Listener>()

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getSnapshot = (): SubagentRun[] => this.runs

  private notify() { for (const l of this.listeners) l() }

  /** Worker recebeu a ordem e começou. `depth`/`parentId` posicionam o worker na
   *  árvore (subagentes aninhados, v2.88.0); ausentes → raiz (depth 1). */
  start(id: string, task: string, model: string, startedAt: number, depth = 1, parentId?: string): void {
    const run: SubagentRun = { id, task, model, status: 'working', steps: 0, toolsUsed: [], startedAt, depth, parentId }
    this.runs = [...this.runs.filter((r) => r.id !== id), run]
    this.notify()
  }

  /** Progresso intermediário (passo/ferramenta) — mantém o status "trabalhando". */
  progress(id: string, steps: number, toolsUsed: string[], lastTool?: string): void {
    this.runs = this.runs.map((r) => (r.id === id ? { ...r, steps, toolsUsed: [...toolsUsed], lastTool } : r))
    this.notify()
  }

  /** Worker entregou a síntese. */
  finish(id: string, result: string, steps: number, toolsUsed: string[], endedAt: number): void {
    this.runs = this.runs.map((r) =>
      r.id === id ? { ...r, status: 'done', result, steps, toolsUsed: [...toolsUsed], endedAt } : r)
    this.notify()
  }

  /** Worker falhou. */
  fail(id: string, result: string, endedAt: number): void {
    this.runs = this.runs.map((r) => (r.id === id ? { ...r, status: 'error', result, endedAt } : r))
    this.notify()
  }

  /** Zera (início de turno / botão Parar). */
  clear(): void {
    if (this.runs.length) { this.runs = []; this.notify() }
  }
}
