// ─── Scout proativo (pesquisa especulativa inteligente) — v2.200.0 ────
//
// Quando a IA principal está em trabalho AGÊNTICO com subagentes ociosos E
// em Esforço Alto/Ultracode, um "scout" pesquisa por conta própria DADOS ATUAIS E
// CONHECIMENTO TÉCNICO ESPECULATIVO (com a data de hoje) sobre a tarefa.
//
// Melhores práticas do Scout Inteligente:
// 1. Filtra tarefas locais puras (edição de arquivo, formatação, leitura mecânica).
// 2. Classifica a intenção (só dispara em erro, documentação, frameworks, APIs, comparações).
// 3. Formata buscas técnicas limpas e precisas (sem caminhos de arquivo locais ou verbosidades).
// 4. Descarta respostas vazias ou ruidosas ("não encontrei", "sem tópicos").

/** Stopwords e comandos meta/continuação PT+EN. */
const STOP = new Set([
  'como', 'para', 'pela', 'pelo', 'qual', 'quais', 'onde', 'quando', 'porque',
  'sobre', 'entre', 'depois', 'antes', 'ainda', 'aqui', 'isso', 'isto', 'esse',
  'essa', 'este', 'esta', 'mesmo', 'muito', 'pouco', 'mais', 'menos', 'todo',
  'toda', 'cada', 'outro', 'outra', 'entao', 'assim', 'tambem', 'apenas', 'uma',
  'agora', 'hoje', 'atual', 'voce', 'fazer', 'usar', 'quero', 'preciso', 'vou',
  'continue', 'continuar', 'continua', 'prossiga', 'prosseguir', 'seguinte',
  'avancar', 'avance', 'siga', 'repetir', 'resumir', 'resumo', 'iniciar', 'inicie',
  'parar', 'cancelar', 'ajuda', 'favor', 'pode', 'vamos', 'bora', 'editar',
  'escrever', 'formata', 'formatar', 'renomear', 'alinhar', 'criar', 'deletar',
  'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'your',
  'about', 'into', 'than', 'then', 'them', 'they', 'have', 'will', 'would',
  'could', 'should', 'much', 'more', 'most', 'some', 'here', 'there', 'current',
  'today', 'using', 'make', 'want', 'need', 'next', 'more', 'repeat', 'resume',
  'retry', 'start', 'stop', 'cancel', 'please', 'going', 'edit', 'write', 'format',
])

// Os dois conjuntos sao testados contra o texto NORMALIZADO (sem acento, ver
// `norm`), entao bastam as formas sem acento — "comentario" casa "comentario".

/** Tarefa puramente local/mecanica: nao ha o que pesquisar na web. */
const LOCAL_MECHANICAL_PATTERNS = [
  /^\s*(formate?|formatar|renomeie|rename|renomear|indente?|indent|alinh\w*)\b/,
  /^\s*(read_file|write_file|edit_file|list_directory|project_tree|glob_files|search_files)\b/,
  /\b(adicione?|coloque|insira|escreva)\s+(um\s+|uma\s+)?(comentario|log|console\.log|docstring)\b/,
  /\b(leia|abra|mostre|exiba|liste)\s+(o\s+|a\s+|esse\s+|este\s+|essa\s+)?(arquivo|diretorio|pasta)\b/,
]

/** Sinal REAL de que pesquisa externa ajuda. Sem um destes, o scout nao roda. */
const SPECULATIVE_WORTHY_PATTERNS = [
  /\b(erro|error|exception|stacktrace|traceback|panic|segfault|failed|falha|bug|unhandled)\b/,
  /\b(versao|version|latest|atualiza\w*|upgrade|release|changelog|deprecated|obsolet\w*|breaking)\b/,
  /\b(docs?|documentacao|api|sdk|library|framework|package|npm|pnpm|yarn|pip|pypi|cargo|crate)\b/,
  // sufixo livre: 'diferenca' nao casava 'diferencas' (plural). O teste antigo
  // passava so por causa do catch-all que foi removido — o padrao nunca casou.
  /\b(diferenc\w*|differen\w*|vs|versus|compar\w*|benchmark|melhor forma|best way|alternativa\w*)\b/,
]

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Palavras de conteúdo (≥4 chars, não-stopword) do foco — a "chave" do tema. */
export function topicKey(text: string): Set<string> {
  return new Set(
    norm(text).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)),
  )
}


/** Sinal FRACO: sozinho nao justifica busca ("como formatar esse arquivo"),
 *  mas justifica quando vem com um token TECNICO junto. */
const HOW_TO_PATTERN = /\b(como|how to|implementar|implement|configurar|configure|integrar|integrate|tutorial)\b/
/** Token tecnico: CamelCase interno (WebSocket, TypeScript) ou identificador
 *  pontuado/hifenizado (react-dom, node.js). Testado no texto ORIGINAL — o
 *  normalizado ja perdeu a caixa. */
const TECH_TOKEN = /[a-z][A-Z]|\b[a-z0-9]+[.-][a-z0-9]+\b/

/** Classifica se o texto do foco/atividade justifica pesquisa proativa na web. */
export function isSpeculativeSearchWorthy(text: string): boolean {
  const t = String(text || '').trim()
  if (!t || t.length < 5) return false
  const n = norm(t)

  // Tarefa local VENCE. Antes um `&& !isWorthy` deixava escapar qualquer texto
  // que contivesse um termo "digno" — e como a lista tinha "como", quase toda
  // frase em portugues passava: "como formatar esse arquivo" disparava busca.
  if (LOCAL_MECHANICAL_PATTERNS.some((p) => p.test(n))) return false

  // Sinal real e OBRIGATORIO. Antes havia o escape `keys.size >= 2`, verdadeiro
  // para praticamente qualquer frase — na pratica o classificador devolvia true
  // quase sempre e as duas listas acima eram decorativas.
  if (SPECULATIVE_WORTHY_PATTERNS.some((p) => p.test(n))) return topicKey(t).size > 0

  // "Como implementar WebSocket em TypeScript" É pesquisa; "como formatar esse
  // arquivo" não é. A diferença não está no "como" — está em haver um token
  // técnico junto. Por isso o sinal fraco só conta acompanhado.
  if (HOW_TO_PATTERN.test(n) && TECH_TOKEN.test(t)) return topicKey(t).size > 0

  return false
}

// Regex de limpeza da query (nomeados p/ manter stripPathNoise legivel).
const WIN_PATH = /^[A-Za-z]:[\\/]/
const POSIX_PATH = /^\/(?:[\w.-]+\/)+[\w.-]*$/
const URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/([^/\s]+)/i
const TOOL_PREFIX = /\b(read_file|write_file|edit_file|execute_command|web_search|list_directory):/gi
const WS = /\s+/g

/** Tira ruido de CAMINHO sem destruir o que da valor a busca. A regra antiga
 *  apagava tudo depois de QUALQUER barra, entao:
 *    "https://react.dev/blog" -> "https"  (o dominio, o termo util, sumia)
 *    "@types/node"            -> "types"
 *    "next/image vs img"      -> ""       (a query inteira virava "comparar")
 *  A decisao agora e por TOKEN, previsivel: caminho de disco sai, URL vira o
 *  host, e nome de pacote com barra fica intacto. */
function stripPathNoise(text: string): string {
  return String(text || '')
    .split(/[ 	]+/)
    .map((tok) => {
      if (WIN_PATH.test(tok)) return ''            // C:PATH de disco
      if (POSIX_PATH.test(tok)) return ''          // /home/user/app/src
      const url = tok.match(URL_HOST)              // URL -> so o host
      if (url) return url[1]
      return tok
    })
    .join(' ')
}

/** Formata uma query de pesquisa limpa e tecnica para o scout. */
export function buildScoutQuery(objective: string, activity: string): string {
  const combined = [objective, activity].map((s) => (s || '').trim()).filter(Boolean).join(' ')
  const cleaned = combined
    ? stripPathNoise(combined)
        .replace(TOOL_PREFIX, '')
        .replace(WS, ' ')
        .trim()
    : ''

  const keys = Array.from(topicKey(cleaned))
  if (!keys.length) return ''

  return keys.slice(0, 6).join(' ')
}

/** Valida a resposta do worker do scout, descartando ruídos e respostas vazias. */
export function validateScoutResult(text: string | null | undefined): string | null {
  if (!text) return null
  const t = String(text).trim()
  if (t.length < 25) return null

  const noisePatterns = [
    /n[ãa]o consigo determinar/i,
    /n[ãa]o foi poss[íi]vel/i,
    /sem t[óo]pico ou pergunta/i,
    /no information found/i,
    /unclear query/i,
    /n[ãa]o encontrei/i,
    /sem resposta do modelo/i,
    /insufficient info/i,
  ]

  if (noisePatterns.some((p) => p.test(t))) return null
  return t
}

/** Sobreposição (Jaccard) entre duas chaves de tema. */
export function keyOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}

/** O tema mudou o bastante para encerrar a pesquisa atual e recomeçar? */
export function shouldRestart(newKey: Set<string>, runningKey: Set<string> | null): boolean {
  if (!runningKey || !runningKey.size) return true
  return keyOverlap(newKey, runningKey) < 0.34
}

/** Monta o foco a pesquisar a partir do objetivo do turno + a atividade atual da IA. */
export function inferScoutFocus(objective: string, activity: string): string {
  const query = buildScoutQuery(objective, activity)
  if (query) return query
  return [objective, activity].map((s) => (s || '').trim()).filter(Boolean).join(' — ').slice(0, 400)
}

export interface ScoutMsgLike { role?: string; content?: string; tool_calls?: any[] }

/** "O que a IA está fazendo AGORA" = a ÚLTIMA ferramenta chamada NESTE turno (nome + resumo). */
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
export type RunScout = (topic: string, signal: AbortSignal) => Promise<string | null>

export const SCOUT_MAX_PER_TURN = 6

/** Orquestra o scout ao longo de um turno agêntico. */
export class ScoutController {
  enabled = false
  private paused = false
  private runningKey: Set<string> | null = null
  private lastKey: Set<string> | null = null
  private abort: AbortController | null = null
  private inFlight = false
  private result: ScoutResult | null = null
  private launched = 0

  reset(enabled: boolean): void {
    this.cancel()
    this.enabled = enabled
    this.paused = false
    this.result = null
    this.launched = 0
    this.lastKey = null
  }

  pause(): void { this.paused = true; this.cancel() }
  resume(): void { this.paused = false }

  takeResult(): ScoutResult | null { const r = this.result; this.result = null; return r }

  get busy(): boolean { return this.inFlight }

  step(focus: string, steer: string, runScout: RunScout, canStart: () => boolean): void {
    if (!this.enabled || this.paused) return
    if (this.launched >= SCOUT_MAX_PER_TURN) return

    const candidateText = steer || focus
    if (!isSpeculativeSearchWorthy(candidateText)) return

    const query = buildScoutQuery(focus, steer)
    const key = topicKey(query)
    if (!key.size) return

    if (this.inFlight) {
      if (!shouldRestart(key, this.runningKey)) return
    } else {
      if (this.result) return
      if (this.lastKey && !shouldRestart(key, this.lastKey)) return
    }
    if (!canStart()) return
    this.launch(query || focus, key, runScout)
  }

  private launch(focus: string, key: Set<string>, runScout: RunScout): void {
    this.cancel()
    this.runningKey = key
    this.lastKey = key
    this.inFlight = true
    this.launched++
    const ac = new AbortController()
    this.abort = ac
    runScout(focus, ac.signal).then(
      (text) => {
        if (ac.signal.aborted) return
        this.inFlight = false
        const valid = validateScoutResult(text)
        if (valid) this.result = { topic: focus, text: valid }
      },
      () => { if (!ac.signal.aborted) this.inFlight = false },
    )
  }

  cancel(): void {
    this.abort?.abort()
    this.abort = null
    this.runningKey = null
    this.inFlight = false
  }

  clear(): void { this.cancel(); this.result = null; this.paused = false; this.lastKey = null }
}
