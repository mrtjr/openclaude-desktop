// ─── Research workers (subagentes COM ferramentas) — v2.63.0 ────────
//
// Antes, o delegate_subtasks disparava subagentes SEM ferramentas: cada um era
// uma chamada única que só raciocinava sobre o que o agente principal colava no
// prompt. Agora cada subagente roda seu PRÓPRIO loop de ferramentas de LEITURA/
// PESQUISA (web_search, fetch_url, read_file, search_files, list_directory) —
// ele busca/lê sozinho e devolve uma síntese. Isso é o "research-ready" +
// "delegates and parallelizes" do Claude Code / Hermes-agent.
//
// SPLIT ORQUESTRADOR-WORKER: o modelo forte (Modal/nuvem) fica no loop principal
// PLANEJANDO; o enxame de workers roda no Ollama local — paralelo de verdade e
// custo ~zero, sem o gargalo de "1 requisição por vez" do Modal. Ver
// useToolExecution.ts (fiação) e delegate_subtasks.
//
// Tudo aqui é PURO e testável: `chat` (chamar o modelo) e `exec` (rodar uma
// ferramenta) são INJETADOS — sem IPC/window neste módulo.

export interface WorkerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: any[]
  tool_call_id?: string
}

export interface WorkerToolCall {
  id: string
  name: string
  args: Record<string, any>
}

export interface WorkerChatResult {
  content: string
  toolCalls: WorkerToolCall[]
  error?: string
}

/** Faz UMA chamada ao modelo com as mensagens + schemas de ferramentas. */
export type WorkerChat = (messages: WorkerMessage[], tools: any[]) => Promise<WorkerChatResult>
/** Executa UMA ferramenta (já restrita à allowlist no lado de quem injeta). */
export type WorkerExec = (name: string, args: Record<string, any>) => Promise<string>

/** Allowlist de ferramentas de LEITURA/PESQUISA que um worker pode usar. É a
 *  fronteira de segurança rígida: mesmo que o modelo do worker alucine uma
 *  chamada de escrita/execução, só estas rodam de fato. */
export const WORKER_TOOL_NAMES = new Set<string>([
  'web_search', 'fetch_url', 'read_file', 'search_files', 'list_directory',
])

// ─── Subagentes ANINHADOS (v2.88.0) ─────────────────────────────────
// Igual ao "sub-agents can spawn their own sub-agents" do Claude Code (Week 24):
// um worker, quando a profundidade ainda permite, ganha a ferramenta
// delegate_subtasks e pode quebrar o próprio sub-problema em sub-workers (que
// também são read-only). A profundidade é LIMITADA (teto 5, como o Claude Code)
// e o fan-out por chamada é limitado — sem isso, modelos locais explodiriam em
// árvores concorrentes. A concorrência global continua sob o Semaphore: os
// filhos rodam SEQUENCIALMENTE dentro da vaga já segurada pelo pai (ver
// useToolExecution), então a carga simultânea de Ollama nunca passa do teto.

/** Nome da ferramenta de delegação — oferecida a um worker só quando a
 *  profundidade ainda permite aninhar. */
export const DELEGATE_TOOL_NAME = 'delegate_subtasks'

/** Profundidade máxima padrão da árvore. 1 = SEM aninhamento (clássico: só os
 *  workers diretos do orquestrador). 2 = um worker pode abrir UM nível de
 *  sub-workers. */
export const DEFAULT_SUBAGENT_MAX_DEPTH = 2
/** Teto rígido de profundidade (igual ao Claude Code). Além disso o
 *  custo/risco de explosão em modelos locais não compensa. */
export const SUBAGENT_MAX_DEPTH_CAP = 5
/** Quantas sub-subtarefas um worker pode abrir POR chamada de delegação —
 *  trava contra explosão combinatória (um worker pedindo dezenas de filhos). */
export const NESTED_FANOUT_CAP = 4

/** Um worker NA profundidade `depth` (1 = worker direto do orquestrador) ainda
 *  pode delegar? Só enquanto há orçamento de profundidade. */
export function canDelegateAtDepth(depth: number, maxDepth: number): boolean {
  return Number(depth) < Math.max(1, Math.floor(Number(maxDepth) || 1))
}

/** Normaliza a profundidade máxima vinda das settings ao intervalo válido.
 *  Não-numérico/ausente → default; números finitos são fixados em [1, teto]. */
export function normalizeMaxDepth(raw: any): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return DEFAULT_SUBAGENT_MAX_DEPTH
  return Math.max(1, Math.min(SUBAGENT_MAX_DEPTH_CAP, n))
}

/** Allowlist de um worker na profundidade `depth`: leitura SEMPRE; +
 *  delegate_subtasks quando a profundidade ainda permite aninhar. É a fronteira
 *  de segurança: um worker no fundo da árvore nem recebe a ferramenta. */
export function workerToolNamesForDepth(depth: number, maxDepth: number): Set<string> {
  const names = new Set(WORKER_TOOL_NAMES)
  if (canDelegateAtDepth(depth, maxDepth)) names.add(DELEGATE_TOOL_NAME)
  return names
}

/** Schemas de ferramentas de um worker na profundidade `depth` — reusa os reais
 *  (constants/tools.ts), incluindo delegate_subtasks só quando permitido. */
export function buildWorkerToolsForDepth(allTools: any[], depth: number, maxDepth: number): any[] {
  if (!Array.isArray(allTools)) return []
  const allow = workerToolNamesForDepth(depth, maxDepth)
  return allTools.filter((t) => allow.has(t?.function?.name))
}

/** Limita o fan-out de UMA delegação aninhada ao teto rígido. */
export function capNestedSubtasks<T>(subtasks: T[], cap = NESTED_FANOUT_CAP): T[] {
  return Array.isArray(subtasks) ? subtasks.slice(0, Math.max(1, cap)) : []
}

export const DEFAULT_WORKER_MAX_STEPS = 6
/** Quantos workers rodam ao mesmo tempo no Ollama (limitado pela VRAM local;
 *  o resto enfileira). Modal-pool usa o nº de keys como teto. */
export const DEFAULT_WORKER_CONCURRENCY = 4
/** Teto por resultado de ferramenta injetado de volta no worker (evita um
 *  fetch_url gigante estourar a janela do modelo local). */
export const WORKER_TOOL_RESULT_CAP = 8000

export const WORKER_SYSTEM_PROMPT: Record<string, string> = {
  pt: 'Você é um subagente de PESQUISA com ferramentas APENAS DE LEITURA (web_search, fetch_url, read_file, search_files, list_directory). Use-as para coletar o que precisa e então devolva uma SÍNTESE objetiva e auto-contida — itens-chave, caminhos/fontes citados e a conclusão. Você NÃO pode escrever, editar nem executar comandos: só ler e buscar. Pare de usar ferramentas assim que tiver o suficiente para responder; não repita a mesma busca.',
  en: 'You are a RESEARCH subagent with READ-ONLY tools (web_search, fetch_url, read_file, search_files, list_directory). Use them to gather what you need, then return a concise, self-contained SYNTHESIS — key points, paths/sources cited, and the conclusion. You CANNOT write, edit, or run commands — only read and search. Stop using tools as soon as you have enough to answer; do not repeat the same query.',
}

/** Cláusula extra do prompt quando o worker AINDA pode aninhar (v2.88.0): avisa
 *  que ele tem delegate_subtasks à disposição — usar com parcimônia. */
export const WORKER_DELEGATE_CLAUSE: Record<string, string> = {
  pt: ' Se a sua tarefa se dividir em sub-investigações INDEPENDENTES, você também pode chamar delegate_subtasks para abrir sub-workers (eles também só leem/buscam) e sintetizar o que voltarem. Use com PARCIMÔNIA — só quando dividir realmente acelera; senão, pesquise você mesmo.',
  en: ' If your task splits into INDEPENDENT sub-investigations, you may also call delegate_subtasks to spawn sub-workers (they are read-only too) and synthesize what they return. Use SPARINGLY — only when splitting genuinely speeds things up; otherwise just research it yourself.',
}

/** System prompt do worker para uma dada profundidade: o base de leitura + a
 *  cláusula de delegação quando ainda dá para aninhar. */
export function workerSystemPrompt(lang: string, canDelegate: boolean): string {
  const base = WORKER_SYSTEM_PROMPT[lang] ?? WORKER_SYSTEM_PROMPT.pt
  if (!canDelegate) return base
  return base + (WORKER_DELEGATE_CLAUSE[lang] ?? WORKER_DELEGATE_CLAUSE.pt)
}

/** Filtra os schemas completos de ferramentas para só os de leitura do worker —
 *  reusa as descrições/parâmetros reais (constants/tools.ts) sem duplicar. */
export function buildWorkerTools(allTools: any[]): any[] {
  if (!Array.isArray(allTools)) return []
  return allTools.filter((t) => WORKER_TOOL_NAMES.has(t?.function?.name))
}

/** Resolve o modelo Ollama de UMA subtarefa (multi-modelo, v2.64.0):
 *  - se o orquestrador pediu um modelo E ele está na lista permitida → usa-o;
 *  - senão, rodízio determinístico sobre a lista (pelo índice da subtarefa);
 *  - sem lista configurada → respeita o pedido, ou cai no fallback.
 *  Validar contra a lista impede o orquestrador de pedir um modelo não
 *  instalado (que daria 404 no Ollama). */
export function resolveSubagentModel(
  requested: string | undefined,
  index: number,
  allowed: string[] | undefined,
  fallback: string,
): string {
  const list = (allowed || []).map((s) => String(s).trim()).filter(Boolean)
  const req = (requested || '').trim()
  if (!list.length) return req || fallback
  if (req && list.includes(req)) return req
  const i = ((index % list.length) + list.length) % list.length
  return list[i]
}

/** Escolhe um modelo de FALLBACK quando um worker FALHOU no modelo atribuído
 *  (v2.83.1): prefere OUTRO modelo da lista permitida (ex.: um menor que cabe na
 *  VRAM), pois um fallback fixo pode nem estar instalado. Devolve '' quando não
 *  há alternativa distinta (→ sem retry). Resolve o caso real: modelo de 9b
 *  falha por OOM/thrash sob concorrência, mas o qwen3:8b da mesma lista entrega. */
export function pickFallbackModel(
  failedModel: string,
  allowed: string[] | undefined,
  fallback: string,
): string {
  const failed = (failedModel || '').trim()
  const list = (allowed || []).map((s) => String(s).trim()).filter(Boolean)
  const alt = list.find((m) => m && m !== failed)
  if (alt) return alt
  const fb = (fallback || '').trim()
  return fb && fb !== failed ? fb : ''
}

/** Injeta a lista de modelos configurados na descrição do delegate_subtasks, p/
 *  o orquestrador saber o que pode pôr no campo "model" de cada subtarefa.
 *  Clona raso só a tool afetada (não muta a entrada). Lista vazia → sem efeito. */
export function applySubagentModels(tools: any[], models: string[] | undefined): any[] {
  const list = (models || []).map((s) => String(s).trim()).filter(Boolean)
  if (!Array.isArray(tools) || !list.length) return tools
  return tools.map((t) => {
    if (t?.function?.name !== 'delegate_subtasks') return t
    const hint = ` You may set "model" per subtask to ONE of the configured Ollama models: ${list.join(', ')} — pick the best fit per subtask (e.g. a coding model for code research, a general model for web). Omit "model" to auto-rotate across them.`
    return { ...t, function: { ...t.function, description: (t.function.description || '') + hint } }
  })
}

/** Argumentos de tool_call podem chegar como string JSON (OpenAI/Modal) OU já
 *  como objeto (Ollama). Coage os dois com segurança. */
function parseArgs(a: any): Record<string, any> {
  if (a && typeof a === 'object') return a
  if (typeof a === 'string') {
    try { return JSON.parse(a || '{}') } catch { return {} }
  }
  return {}
}

/** Normaliza tool_calls cruas do modelo numa lista limpa. */
export function parseRawToolCalls(raw: any): WorkerToolCall[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((tc) => tc?.function?.name)
    .map((tc, i) => ({
      id: tc.id || `wc_${i}`,
      name: String(tc.function.name),
      args: parseArgs(tc.function.arguments),
    }))
}

/** Coage o corpo OpenAI-compatível (ou {error}) num WorkerChatResult. */
export function normalizeWorkerChat(body: any, error?: string): WorkerChatResult {
  if (error) return { content: '', toolCalls: [], error }
  if (!body || body.error) return { content: '', toolCalls: [], error: body?.error || 'sem resposta do modelo' }
  const msg = body.choices?.[0]?.message || {}
  return {
    content: typeof msg.content === 'string' ? msg.content : '',
    toolCalls: parseRawToolCalls(msg.tool_calls),
  }
}

/** Resumo curto das ferramentas usadas, ex.: "web_search×2, fetch_url". */
export function summarizeToolsUsed(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1)
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${n}×${c}` : n)).join(', ')
}

export interface RunWorkerOpts {
  messages: WorkerMessage[]
  tools: any[]
  chat: WorkerChat
  exec: WorkerExec
  maxSteps?: number
  toolResultCap?: number
  /** Prompt de "sintetize agora, sem mais ferramentas" quando bate o teto de
   *  passos — força uma resposta final em vez de devolver vazio. */
  finalNudge?: string
  /** Permite cancelar entre passos (ex.: botão Parar). */
  isStopped?: () => boolean
  /** Progresso ao vivo (passo concluído + ferramentas usadas) — alimenta o
   *  painel de atividade dos subagentes (v2.66.0). */
  onProgress?: (p: { step: number; toolsUsed: string[]; lastTool?: string }) => void
}

export interface WorkerOutcome {
  text: string
  steps: number
  toolsUsed: string[]
  capped?: boolean
  error?: boolean
}

/** Loop de um worker: chama o modelo → executa as ferramentas pedidas (read-only)
 *  → realimenta os resultados → repete até a resposta final ou o teto de passos.
 *  Não muta `messages` (clona). */
export async function runResearchWorker(opts: RunWorkerOpts): Promise<WorkerOutcome> {
  const { messages, tools, chat, exec } = opts
  const maxSteps = opts.maxSteps ?? DEFAULT_WORKER_MAX_STEPS
  const cap = opts.toolResultCap ?? WORKER_TOOL_RESULT_CAP
  const convo: WorkerMessage[] = [...messages]
  const toolsUsed: string[] = []
  let last = ''

  for (let step = 0; step < maxSteps; step++) {
    if (opts.isStopped?.()) return { text: last || '[cancelado]', steps: step, toolsUsed }
    const res = await chat(convo, tools)
    if (res.error) {
      return { text: last || `[erro do worker: ${res.error}]`, steps: step + 1, toolsUsed, error: true }
    }
    if (res.content) last = res.content
    if (!res.toolCalls.length) {
      return { text: res.content || last || '[sem resposta]', steps: step + 1, toolsUsed }
    }
    // Registra o turno do assistente (com as tool_calls) antes dos resultados.
    convo.push({
      role: 'assistant',
      content: res.content || '',
      tool_calls: res.toolCalls.map((tc) => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    })
    for (const tc of res.toolCalls) {
      toolsUsed.push(tc.name)
      let result: string
      try { result = await exec(tc.name, tc.args) } catch (e: any) {
        result = `[erro ao executar ${tc.name}: ${e?.message || e}]`
      }
      convo.push({ role: 'tool', tool_call_id: tc.id, content: String(result ?? '').slice(0, cap) })
    }
    // Progresso ao vivo: passo concluído + ferramentas usadas (painel v2.66.0).
    opts.onProgress?.({ step: step + 1, toolsUsed: [...toolsUsed], lastTool: res.toolCalls[res.toolCalls.length - 1]?.name })
  }

  // Bateu o teto de passos: força UMA síntese final sem ferramentas.
  if (opts.isStopped?.()) return { text: last || '[cancelado]', steps: maxSteps, toolsUsed, capped: true }
  if (opts.finalNudge) {
    convo.push({ role: 'user', content: opts.finalNudge })
    const fin = await chat(convo, [])
    const text = fin.error ? (last || `[erro: ${fin.error}]`) : (fin.content || last || '[sem síntese final]')
    return { text, steps: maxSteps + 1, toolsUsed, capped: true, error: !!fin.error && !last }
  }
  return { text: last || '[worker atingiu o limite de passos sem síntese final]', steps: maxSteps, toolsUsed, capped: true }
}

/** Roda thunks com no máximo `cap` em paralelo, preservando a ordem dos
 *  resultados. Workers pegam o próximo da fila assim que liberam um slot. */
export async function runWithConcurrency<T>(thunks: Array<() => Promise<T>>, cap: number): Promise<T[]> {
  const results = new Array<T>(thunks.length)
  let next = 0
  const runner = async () => {
    while (next < thunks.length) {
      const i = next++
      results[i] = await thunks[i]()
    }
  }
  const n = Math.max(1, Math.min(cap, thunks.length || 1))
  await Promise.all(Array.from({ length: n }, () => runner()))
  return results
}
