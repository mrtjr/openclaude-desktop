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
