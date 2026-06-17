// ─── Scout proativo (pesquisa especulativa em ociosidade) — v2.69.0 ──
//
// Quando a IA principal está em trabalho AGÊNTICO mas com subagentes ociosos, um
// "scout" pesquisa por conta própria DADOS ATUAIS (com a data de hoje) e
// CAMINHOS ALTERNATIVOS sobre o que ela está fazendo, e injeta isso no contexto
// dela — resolvendo o gap de conhecimento desatualizado do treino. O tema é
// inferido AO VIVO a cada passo: se a IA muda de assunto, o scout encerra e
// recomeça; se delega algo explícito, o scout PAUSA (cede a vaga) e retoma
// depois. Só roda em vaga ociosa do semáforo (nunca bloqueia delegações).
//
// Helpers puros + um controller testável (runScout é injetado).

/** Stopwords PT+EN (forma normalizada) para extrair palavras de CONTEÚDO do foco
 *  — reaproveita a ideia do recallFreshFacts. */
const STOP = new Set([
  'como', 'para', 'pela', 'pelo', 'qual', 'quais', 'onde', 'quando', 'porque',
  'sobre', 'entre', 'depois', 'antes', 'ainda', 'aqui', 'isso', 'isto', 'esse',
  'essa', 'este', 'esta', 'mesmo', 'muito', 'pouco', 'mais', 'menos', 'todo',
  'toda', 'cada', 'outro', 'outra', 'entao', 'assim', 'tambem', 'apenas', 'uma',
  'agora', 'hoje', 'atual', 'voce', 'fazer', 'usar', 'quero', 'preciso', 'vou',
  'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'your',
  'about', 'into', 'than', 'then', 'them', 'they', 'have', 'will', 'would',
  'could', 'should', 'much', 'more', 'most', 'some', 'here', 'there', 'current',
  'today', 'using', 'make', 'want', 'need',
])

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Palavras de conteúdo (≥4 chars, não-stopword) do foco — a "chave" do tema. */
export function topicKey(text: string): Set<string> {
  return new Set(
    norm(text).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)),
  )
}

/** Sobreposição (Jaccard) entre duas chaves de tema. */
export function keyOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}

/** O tema mudou o bastante para encerrar a pesquisa atual e recomeçar? Limiar
 *  conservador (só recomeça em mudança clara) para não ficar reiniciando à toa. */
export function shouldRestart(newKey: Set<string>, runningKey: Set<string> | null): boolean {
  if (!runningKey || !runningKey.size) return true
  return keyOverlap(newKey, runningKey) < 0.34
}

/** Monta o foco a pesquisar a partir do objetivo do turno + a atividade atual da
 *  IA (última ação/trecho). */
export function inferScoutFocus(objective: string, activity: string): string {
  return [objective, activity].map((s) => (s || '').trim()).filter(Boolean).join(' — ').slice(0, 400)
}

export interface ScoutMsgLike { role?: string; content?: string; tool_calls?: any[] }

/** "O que a IA está fazendo AGORA" = a ÚLTIMA ferramenta chamada NESTE turno
 *  (nome + resumo do argumento), olhando só de `baseLen` em diante. A PROSA do
 *  assistente é IGNORADA de propósito: ela é conversa ("Excelente!", "Agora
 *  vou…", "O domínio…") e fazia o scout pesquisar lixo (v2.86.0). A ação é o
 *  sinal real do que está sendo feito. `summarize` é injetado (toolCallSummary).
 *  Devolve '' quando não houve ação ainda — aí o foco fica só no objetivo. */
export function pickScoutActivity(
  messages: ScoutMsgLike[] | undefined,
  baseLen: number,
  summarize: (name: string, args: Record<string, any>) => string,
): string {
  if (!Array.isArray(messages)) return ''
  const from = Math.max(0, baseLen | 0)
  for (let i = messages.length - 1; i >= from; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls[0]) continue
    const tc = m.tool_calls[0]
    const name = String(tc?.function?.name || '').trim()
    if (!name) continue
    let args: Record<string, any> = {}
    try {
      const raw = tc.function?.arguments
      args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
    } catch { args = {} }
    let sum = ''
    try { sum = summarize(name, args) } catch { sum = '' }
    return sum ? `${name}: ${sum}` : name
  }
  return ''
}

/** System prompt do scout: foco em frescor (data de hoje) + atalhos. */
export function scoutSystemPrompt(lang: string, todayISO: string): string {
  return lang === 'en'
    ? `You are a proactive RESEARCH SCOUT with read-only tools. The main AI is working on a task and you run in the background to give it an edge. Today is ${todayISO}. Use web_search/fetch_url to find the MOST CURRENT information (as of today — NOT your training data) and faster ALTERNATIVE approaches/shortcuts relevant to what it is doing. Verify time-sensitive facts on the web. Return ONLY what is genuinely new, current, and useful (versions, breaking changes, a better path) — be brief and cite sources. If you find nothing better than what it likely already knows, say so in one line.`
    : `Você é um SCOUT de pesquisa proativo com ferramentas só de leitura. A IA principal está trabalhando numa tarefa e você roda em background para dar vantagem a ela. Hoje é ${todayISO}. Use web_search/fetch_url para achar a informação MAIS ATUAL (de hoje — NÃO os dados do seu treino) e CAMINHOS ALTERNATIVOS/atalhos mais rápidos para o que ela está fazendo. Verifique fatos sensíveis a tempo na web. Devolva SÓ o que for realmente novo, atual e útil (versões, mudanças recentes, um caminho melhor) — seja breve e cite as fontes. Se não achar nada melhor do que ela provavelmente já sabe, diga isso em uma linha.`
}

export interface ScoutResult { topic: string; text: string }
/** Executa um scout sobre `topic`; resolve com o texto (ou null se abortado/sem
 *  vaga). Injetado pelo App/useToolExecution (tem acesso ao worker/semáforo). */
export type RunScout = (topic: string, signal: AbortSignal) => Promise<string | null>

/** Teto de pesquisas proativas por turno (rede contra custo infinito). */
export const SCOUT_MAX_PER_TURN = 6

/** Orquestra o scout ao longo de um turno agêntico: (re)inicia conforme o tema,
 *  pausa em delegações, guarda o resultado para o loop injetar. Testável com um
 *  runScout falso. */
export class ScoutController {
  enabled = false
  private paused = false
  private runningKey: Set<string> | null = null
  private abort: AbortController | null = null
  private inFlight = false
  private result: ScoutResult | null = null
  private launched = 0

  /** Início de turno: zera e define se está ligado. */
  reset(enabled: boolean): void {
    this.cancel()
    this.enabled = enabled
    this.paused = false
    this.result = null
    this.launched = 0
  }

  /** Delegação explícita assume o recurso → pausa e aborta a pesquisa atual. */
  pause(): void { this.paused = true; this.cancel() }
  /** Delegação terminou → libera o scout para retomar no próximo passo. */
  resume(): void { this.paused = false }

  /** O loop consome o resultado pronto (1x) para injetar no contexto. */
  takeResult(): ScoutResult | null { const r = this.result; this.result = null; return r }

  /** Há um scout rodando agora? */
  get busy(): boolean { return this.inFlight }

  /** Chamado a cada passo com o foco atual da IA. (Re)inicia o scout se o tema
   *  mudou e houver vaga (canStart). */
  step(focus: string, runScout: RunScout, canStart: () => boolean): void {
    if (!this.enabled || this.paused) return
    if (this.launched >= SCOUT_MAX_PER_TURN) return
    const key = topicKey(focus)
    if (!key.size) return
    if (this.inFlight) {
      // Rodando: só interrompe se o tema mudou claramente.
      if (!shouldRestart(key, this.runningKey)) return
    } else {
      // Parado com resultado ainda não consumido → espera o loop injetar.
      if (this.result) return
    }
    if (!canStart()) return
    this.launch(focus, key, runScout)
  }

  private launch(focus: string, key: Set<string>, runScout: RunScout): void {
    this.cancel()
    this.runningKey = key
    this.inFlight = true
    this.launched++
    const ac = new AbortController()
    this.abort = ac
    runScout(focus, ac.signal).then(
      (text) => {
        // Run abortado = foi SUPERSEDIDO por um launch novo (ou cancelado): o
        // estado (inFlight/abort) já pertence ao run atual; não tocar nele,
        // senão a resolução tardia deste run zerava o inFlight do run novo —
        // quebrava "um scout por vez" e relançava/abortava à toa.
        if (ac.signal.aborted) return
        this.inFlight = false
        if (text && text.trim()) this.result = { topic: focus, text }
      },
      () => { if (!ac.signal.aborted) this.inFlight = false },
    )
  }

  /** Aborta a pesquisa em voo (se houver) e limpa o tema rodando. */
  cancel(): void {
    this.abort?.abort()
    this.abort = null
    this.runningKey = null
    this.inFlight = false
  }

  /** Fim de turno / Parar: aborta e zera tudo. */
  clear(): void { this.cancel(); this.result = null; this.paused = false }
}
