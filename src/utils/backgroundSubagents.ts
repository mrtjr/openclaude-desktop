// ─── Registro de subagentes em background (v2.65.0) ─────────────────
//
// Permite que delegate_subtasks rode em modo BACKGROUND (padrão run_in_background
// do Claude): o tool retorna na hora um handle e os workers seguem rodando; o
// loop do useChat injeta os resultados quando prontos (no topo de cada passo) e,
// se for encerrar com pendências, DRENA os atrasados antes da resposta final.
// Assim a IA principal continua trabalhando enquanto os workers (Ollama, lentos)
// não entregam.
//
// Turn-scoped: zerado no início de cada turno e no botão Parar. Instância única
// criada no App e compartilhada por useToolExecution (registra) e useChat
// (coleta/drena). A lógica de gestão é testável; as Promises são injetadas.

export interface BgEntry {
  id: string
  label: string
  promise: Promise<string>
  settled: boolean
  result: string | null
}

export class BackgroundSubagentRegistry {
  private entries: BgEntry[] = []
  private counter = 0

  /** Registra um lote em background e devolve o id gerado. NÃO espera. Captura
   *  a resolução/erro da Promise no próprio entry (nunca rejeita pra fora). */
  register(label: string, promise: Promise<string>): string {
    const id = `bg${++this.counter}`
    const entry: BgEntry = { id, label, promise, settled: false, result: null }
    promise.then(
      (r) => { entry.settled = true; entry.result = r },
      (e: any) => { entry.settled = true; entry.result = `[erro no subagente: ${e?.message || e}]` },
    )
    this.entries.push(entry)
    return id
  }

  /** Há alguma tarefa registrada (pendente ou concluída ainda não coletada)? */
  hasAny(): boolean { return this.entries.length > 0 }
  pendingCount(): number { return this.entries.filter((e) => !e.settled).length }

  /** Remove e devolve as já concluídas — para injetar no contexto do próximo passo. */
  takeCompleted(): BgEntry[] {
    const done = this.entries.filter((e) => e.settled)
    if (done.length) this.entries = this.entries.filter((e) => !e.settled)
    return done
  }

  /** Aguarda TODAS as pendentes e devolve o que restava (esvaziando o registro). */
  async drain(): Promise<BgEntry[]> {
    if (!this.entries.length) return []
    await Promise.allSettled(this.entries.map((e) => e.promise))
    const all = this.entries
    this.entries = []
    return all
  }

  /** Descarta tudo (início de turno / botão Parar). As Promises em voo ainda
   *  resolvem, mas seus resultados são abandonados. */
  clear(): void { this.entries = [] }
}
