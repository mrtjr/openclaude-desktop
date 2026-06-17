// ─── Semáforo de concorrência (v2.67.0) ─────────────────────────────
//
// Limita quantas operações rodam ao mesmo tempo. Usado como GATE GLOBAL dos
// subagentes Ollama: no máximo N workers concorrentes em TODO o app (entre
// lotes E turnos) — sem isto, várias delegações empilhavam muitos modelos
// locais ao mesmo tempo e engarrafavam/travavam a máquina. Os excedentes
// esperam na fila (sem consumir recurso) até liberar uma vaga. Puro e testável.

export class Semaphore {
  private max: number
  private active = 0
  private queue: Array<() => void> = []

  constructor(max = 1) { this.max = Math.max(1, Math.floor(max)) }

  /** Quantos rodando agora. */
  get running(): number { return this.active }
  /** Quantos esperando vaga. */
  get waiting(): number { return this.queue.length }
  /** Teto atual. */
  get limit(): number { return this.max }

  /** Ajusta o teto; se aumentou, libera da fila o que couber. */
  setMax(n: number): void {
    this.max = Math.max(1, Math.floor(n || 1))
    this.pump()
  }

  /** Espera uma vaga. Resolve na hora se houver folga. */
  acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return Promise.resolve() }
    return new Promise<void>((resolve) => this.queue.push(resolve))
  }

  /** Libera uma vaga e puxa o próximo da fila. */
  release(): void {
    this.active = Math.max(0, this.active - 1)
    this.pump()
  }

  /** Roda `fn` sob o limite: adquire → executa → libera (sempre, mesmo com erro). */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try { return await fn() } finally { this.release() }
  }

  private pump(): void {
    while (this.active < this.max && this.queue.length) {
      this.active++
      const next = this.queue.shift()!
      next()
    }
  }
}
