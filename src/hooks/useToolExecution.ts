import { useState, useCallback, useRef } from 'react'
import type { AppSettings, PendingApproval, TaskPlan, Conversation } from '../types'
import { TOOLS } from '../constants/tools'
import { resolveToolSearch, formatToolSearchResult } from '../services/toolDeferral'
import { toolNeedsApproval, truncateToolOutput, isToolError } from '../utils/toolPolicy'
import { formatExecResult, resolveExecCwd, resolveExecTimeoutMs } from '../utils/execResult'
import { formatEditResult, formatWriteResult, COACH_REWRITE_MIN_CHARS } from '../utils/editResult'
import { mergeFact, normalizeMemory } from '../utils/persistentMemory'
import { addFreshFact, pruneFreshFacts } from '../utils/freshFacts'
import { parseSearchGlob, formatSearchResults } from '../utils/searchFiles'
import { isRiskyDesktopAction } from '../utils/desktopPolicy'
import { paginateFileContent } from '../utils/readFile'
import { formatClickResult, formatNavResult } from '../utils/browserResult'
import { logInsight } from '../services/devInsights'
import { findSkill, formatLoadSkillResult } from '../utils/skills'
import { matchHooks } from '../utils/hooks'
import { resolveSubagentPrompt } from '../constants/subagents'
import {
  buildWorkerTools, runResearchWorker, runWithConcurrency, normalizeWorkerChat,
  summarizeToolsUsed, resolveSubagentModel, pickFallbackModel, WORKER_TOOL_NAMES,
  buildWorkerToolsForDepth, workerSystemPrompt, canDelegateAtDepth, capNestedSubtasks,
  normalizeMaxDepth, DELEGATE_TOOL_NAME,
  type WorkerChat, type WorkerExec, type WorkerMessage,
} from '../utils/researchWorker'
import type { Skill } from '../types/skill'
import type { ModalKeyPool } from './useModalKeyPool'
import type { BackgroundSubagentRegistry } from '../utils/backgroundSubagents'
import type { SubagentActivityStore } from '../utils/subagentActivity'
import type { Semaphore } from '../utils/semaphore'
import { scoutSystemPrompt } from '../utils/scout'
import { compressOutput } from '../utils/outputCompression'
import { formatRagResults, DEFAULT_RAG_EMBED_MODEL } from '../utils/rag'
import { resolveVisionTarget, formatVisionResult } from '../utils/vision'
import { parseCompareSpecs, providerApiKey, extractChatText, formatComparison, type CompareResult } from '../utils/compareModels'
import { findWorkflow, topoOrder, formatWorkflowRun, type WfRunEntry } from '../utils/workflows'
import { findPersona, isClearPersona, formatSetPersonaResult, type PersonaLike } from '../utils/personas'
import { formatProjectTree } from '../utils/projectTree'
import { formatGlobResults } from '../utils/glob'
import { searchConversations, formatConversationMatches } from '../utils/searchConversations'
import { formatBackgroundStart, formatCommandOutput } from '../utils/backgroundCommands'

interface UseToolExecutionOptions {
  settings: AppSettings
  activeConvId: string | null
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  selectedModel?: string
  modalKeyPool?: ModalKeyPool
  /** Working folder of the active conversation's project — execute_command
   *  runs there by default (the model can still override via args.cwd). */
  projectCwd?: string
  /** Skills disponíveis — usadas pela ferramenta load_skill (v2.27.0). */
  skills?: Skill[]
  /** Roteador de chamadas a tools de servidores MCP (mcp__*) (v2.35.0). */
  callMcpTool?: (name: string, args: Record<string, any>) => Promise<string>
  /** Registro de subagentes em background (v2.65.0) — delegate_subtasks registra
   *  os lotes aqui quando em modo background; useChat coleta/drena. */
  backgroundTasks?: BackgroundSubagentRegistry
  /** Atividade ao vivo dos subagentes (v2.66.0) — alimenta o painel visual. */
  subagentActivity?: SubagentActivityStore
  /** Gate de concorrência GLOBAL dos subagentes Ollama (v2.67.0) — ≤N workers
   *  ao mesmo tempo em todo o app, entre lotes/turnos. */
  subagentLimiter?: Semaphore
  /** Personas disponíveis + callback de ativação — para a ferramenta set_persona
   *  (fusão do PersonaEngine, v2.77.0). */
  personas?: PersonaLike[]
  onSetPersona?: (persona: PersonaLike | null) => void
  /** Lê TODAS as conversas (cross-sessão) para a ferramenta search_conversations
   *  (recall, ideia do Hermes — v2.82.2). Vem do conversationsRef do App. */
  getConversations?: () => Conversation[]
}

export function useToolExecution({ settings, activeConvId, setConversations, selectedModel, modalKeyPool, projectCwd, skills, callMcpTool, backgroundTasks, subagentActivity, subagentLimiter, personas, onSetPersona, getConversations }: UseToolExecutionOptions) {
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const scoutSeqRef = useRef(0) // ids únicos + rodízio de modelo do scout
  const personasRef = useRef(personas)
  personasRef.current = personas
  const onSetPersonaRef = useRef(onSetPersona)
  onSetPersonaRef.current = onSetPersona
  const getConversationsRef = useRef(getConversations)
  getConversationsRef.current = getConversations

  // Use refs to avoid stale closures
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId
  const projectCwdRef = useRef(projectCwd)
  projectCwdRef.current = projectCwd
  const skillsRef = useRef(skills)
  skillsRef.current = skills

  const callMcpToolRef = useRef(callMcpTool)
  callMcpToolRef.current = callMcpTool

  const executeToolRaw = useCallback(async (name: string, args: Record<string, any>): Promise<string> => {
    const convId = activeConvIdRef.current
    try {
      // MCP (v2.35.0): tools de servidores MCP chegam namespaced (mcp__srv__tool)
      // e são roteadas de volta ao servidor, fora do switch das tools nativas.
      if (name.startsWith('mcp__')) {
        if (!callMcpToolRef.current) return `MCP error: roteador indisponível para "${name}"`
        return await callMcpToolRef.current(name, args)
      }
      // ─── tool_search (v2.12.6): meta-tool that lets the model pull
      // full schemas on demand for deferred tools. Accepts either a
      // keyword query or "select:name1,name2" for exact selection.
      if (name === 'tool_search' || name === 'ToolSearch') {
        const query = String(args.query || '').trim()
        const maxResults = Number(args.max_results) || 5
        if (!query) return 'tool_search: missing "query" parameter'
        const matches = resolveToolSearch(query, TOOLS as any).slice(0, maxResults)
        return formatToolSearchResult(matches)
      }
      // load_skill (v2.27.0): devolve as instruções completas de uma skill do
      // manifesto. Lookup puro sobre a lista de skills ativas.
      if (name === 'load_skill') {
        return formatLoadSkillResult(findSkill(skillsRef.current || [], String(args.name || '')), String(args.name || ''))
      }
      if (name === 'execute_command') {
        const cwd = resolveExecCwd(args.cwd, projectCwdRef.current)
        const timeoutMs = resolveExecTimeoutMs(args.timeout_s)
        const result = await window.electron.execCommand({ command: args.command, cwd, timeoutMs })
        return formatExecResult(result)
      }
      if (name === 'run_command_background') {
        // Paridade com Bash run_in_background (v2.83.0): dispara e devolve um
        // handle; a IA segue trabalhando e consulta com get_command_output.
        const cwd = resolveExecCwd(args.cwd, projectCwdRef.current)
        const res = await window.electron.startBackgroundCommand({ command: String(args.command ?? ''), cwd })
        return formatBackgroundStart(res, String(args.command ?? ''))
      }
      if (name === 'get_command_output') {
        const id = String(args.id ?? '').trim()
        if (!id) return 'get_command_output: faltou o parâmetro "id".'
        const res = await window.electron.commandOutput({ id })
        return formatCommandOutput(res, id)
      }
      if (name === 'kill_background_command') {
        const id = String(args.id ?? '').trim()
        if (!id) return 'kill_background_command: faltou o parâmetro "id".'
        const res = await window.electron.killBackgroundCommand({ id })
        return res?.found ? `Comando em background "${id}" interrompido.` : `Nenhum comando em background com id "${id}".`
      }
      if (name === 'read_file') {
        const result = await window.electron.readFile(args.path)
        if (result.content == null) return result.error || ''
        return paginateFileContent(result.content, args.offset, args.limit)
      }
      if (name === 'write_file') {
        const content = String(args.content ?? '')
        // Passa o `content` NORMALIZADO (não o cru): se o modelo manda content
        // ausente/não-string, escreve string vazia em vez de o writeFileSync do
        // main lançar ERR_INVALID_ARG_TYPE — e mantém o byte-count coerente.
        const result = await window.electron.writeFile({ filePath: args.path, content })
        // Anti-padrão medido pelos Dev Insights: reescrita total de arquivo
        // existente (era para ser edit_file). O finding 'prefer-edit-file'
        // agrega estes eventos.
        if (!result.error && result.existed && content.length >= COACH_REWRITE_MIN_CHARS) {
          logInsight('tool', 'rewrite_existing', { bytes: content.length })
        }
        return formatWriteResult(result, args.path, content.length)
      }
      if (name === 'edit_file') {
        const result = await window.electron.editFile({ filePath: args.path, oldString: args.old_string, newString: args.new_string ?? '', replaceAll: args.replace_all === true })
        return formatEditResult(result, args.path)
      }
      if (name === 'search_files') {
        const cwd = resolveExecCwd(args.path, projectCwdRef.current)
        const result = await window.electron.searchFiles({
          query: args.query,
          path: cwd,
          exts: parseSearchGlob(args.glob),
          maxResults: Number(args.max_results) || undefined,
        })
        return formatSearchResults(result, String(args.query ?? ''))
      }
      if (name === 'remember_fact') {
        if (!settings.memoryEnabled) {
          return 'Memória persistente está desativada nas Configurações — nada foi salvo.'
        }
        const current = await window.electron.loadMemory()
        const { memory, added, bucket } = mergeFact(current, args.category, args.content)
        if (!added) return `Já estava na memória (${bucket}) — nada a fazer.`
        const res = await window.electron.saveMemory(memory)
        return res.error
          ? `Erro ao salvar na memória: ${res.error}`
          : `Memória atualizada (${bucket}): "${String(args.content).trim()}"`
      }
      if (name === 'remember_fresh_fact') {
        if (!settings.memoryEnabled) {
          return 'Memória persistente está desativada nas Configurações — nada foi salvo.'
        }
        const content = String(args.content ?? '').trim()
        if (!content) return 'Nada a salvar (conteúdo vazio).'
        const store = normalizeMemory(await window.electron.loadMemory())
        const now = new Date()
        const { list } = addFreshFact(store.fresh, {
          text: content,
          source: args.source ? String(args.source) : undefined,
          ttlDays: typeof args.ttl_days === 'number' ? args.ttl_days : undefined,
        }, now)
        const pruned = pruneFreshFacts(list, now)
        const res = await window.electron.saveMemory({ ...store, fresh: pruned })
        if (res.error) return `Erro ao salvar fato fresco: ${res.error}`
        const ttl = pruned[pruned.length - 1]?.ttlDays
        return `Fato fresco guardado (TTL ${ttl}d) para reuso futuro: "${content}"`
      }
      if (name === 'web_search') {
        const result = await window.electron.webSearch(args.query)
        return result.result || result.error || 'Sem resultados'
      }
      if (name === 'rag_search') {
        // Busca semântica na base LOCAL indexada (fusão do RAGPanel, v2.73.0):
        // gera o embedding da query (Ollama, MESMO modelo do índice) → cosseno
        // topK no main → formata trechos+fontes p/ o modelo citar. Read-only.
        const query = String(args.query ?? '').trim()
        if (!query) return 'rag_search: faltou o parâmetro "query".'
        const topK = Math.min(Math.max(Number(args.top_k) || 5, 1), 12)
        const model = settings.ragEmbeddingModel || DEFAULT_RAG_EMBED_MODEL
        const emb = await window.electron.ragEmbed({ model, text: query })
        if (emb.error || !emb.embedding?.length) {
          return `Não consegui consultar a base de conhecimento: falha ao gerar embedding com o modelo "${model}" via Ollama${emb.error ? ` (${emb.error})` : ''}. Confirme que o Ollama está rodando e o modelo de embedding está instalado (ollama pull ${model}).`
        }
        const search = await window.electron.ragSearch({ queryEmbedding: emb.embedding, topK })
        if (search.error) return `Erro na busca RAG: ${search.error}`
        return formatRagResults(search.results || [], query)
      }
      if (name === 'capture_screen') {
        // Fusão do VisionMode (v2.74.0): captura o desktop e analisa num modelo
        // de visão. Leitura (não muda nada). Ver utils/vision.ts.
        const target = resolveVisionTarget(settings)
        if (!target) return `O provider de visão atual ("${settings.provider}") não suporta análise de imagem. Configure ollama (llava), openai, gemini, anthropic, openrouter ou modal.`
        const prompt = String(args.prompt ?? '').trim() || 'Descreva o que está visível na tela, de forma objetiva.'
        const shot = await window.electron.captureScreen()
        if (shot.error || !shot.base64) return `Não consegui capturar a tela: ${shot.error || 'sem imagem'}.`
        const res = await window.electron.visionChat({
          provider: target.provider, apiKey: target.apiKey, model: target.model,
          prompt, imageBase64: shot.base64, modalHostname: settings.modalHostname,
        })
        return formatVisionResult(res, 'a tela')
      }
      if (name === 'analyze_image') {
        const path = String(args.path ?? '').trim()
        if (!path) return 'analyze_image: faltou o parâmetro "path".'
        const target = resolveVisionTarget(settings)
        if (!target) return `O provider de visão atual ("${settings.provider}") não suporta análise de imagem. Configure ollama (llava), openai, gemini, anthropic, openrouter ou modal.`
        const doc: any = await window.electron.readDocument(path)
        if (doc.error) return `Não consegui ler a imagem "${path}": ${doc.error}.`
        if (!doc.isImage || !doc.base64) return `O arquivo "${path}" não é uma imagem suportada (png/jpg/jpeg/gif/webp/bmp).`
        const prompt = String(args.prompt ?? '').trim() || 'Descreva o conteúdo desta imagem de forma objetiva.'
        const res = await window.electron.visionChat({
          provider: target.provider, apiKey: target.apiKey, model: target.model,
          prompt, imageBase64: doc.base64, modalHostname: settings.modalHostname,
        })
        return formatVisionResult(res, `a imagem ${doc.name || path}`)
      }
      if (name === 'compare_models') {
        // Fusão do ModelArena (v2.75.0): mesmo prompt em N modelos, em paralelo,
        // e devolve lado a lado p/ a IA sintetizar. Ver utils/compareModels.ts.
        const prompt = String(args.prompt ?? '').trim()
        if (!prompt) return 'compare_models: faltou o parâmetro "prompt".'
        const specs = parseCompareSpecs(args.models, settings.provider)
        if (specs.length < 2) return 'compare_models: forneça pelo menos 2 modelos válidos em "models".'
        const results = await Promise.all(specs.map(async (s): Promise<CompareResult> => {
          const start = Date.now()
          try {
            const res = await window.electron.providerChat({
              provider: s.provider, apiKey: providerApiKey(settings, s.provider), model: s.model,
              messages: [{ role: 'user', content: prompt }],
              temperature: settings.temperature, max_tokens: Math.min(settings.maxTokens || 1024, 2048),
              modalHostname: settings.modalHostname, customBaseUrl: settings.customBaseUrl,
            })
            return { provider: s.provider, model: s.model, text: extractChatText(res), ms: Date.now() - start, error: res?.error || null }
          } catch (e: any) {
            return { provider: s.provider, model: s.model, text: '', ms: Date.now() - start, error: e?.message || String(e) }
          }
        }))
        return formatComparison(prompt, results)
      }
      if (name === 'run_workflow') {
        // Fusão do WorkflowBuilder (v2.76.0): roda um workflow SALVO pelo nome.
        // A tool inteira é gateada por aprovação (DANGEROUS_TOOLS) — uma
        // aprovação para o workflow nomeado, que o próprio usuário criou; por
        // isso aqui dentro chamamos o IPC direto. Ver utils/workflows.ts.
        const wfName = String(args.name ?? '').trim()
        if (!wfName) return 'run_workflow: faltou o parâmetro "name".'
        const loaded = await window.electron.workflowLoad()
        const list = loaded?.workflows || []
        const wf = findWorkflow(list as any, wfName)
        if (!wf) {
          const names = list.map((w: any) => w?.name).filter(Boolean).join(', ')
          return `Workflow "${wfName}" não encontrado. Salvos: ${names || '(nenhum)'}.`
        }
        const order = topoOrder(wf.nodes || [], wf.edges || [])
        if (!order.length) return `O workflow "${wf.name}" não tem nós para executar.`
        const entries: WfRunEntry[] = []
        let prevOutput = ''
        for (const nd of order) {
          try {
            let output = ''
            if (nd.type === 'trigger') {
              output = 'gatilho acionado'
            } else if (nd.type === 'prompt') {
              const tpl = String(nd.config.promptTemplate || '{{input}}').replace(/{{input}}/g, prevOutput)
              const provider = nd.config.provider || settings.provider
              const res = await window.electron.providerChat({
                provider, apiKey: providerApiKey(settings, provider), model: nd.config.model || 'llama3',
                messages: [{ role: 'user', content: tpl }], temperature: settings.temperature,
                max_tokens: settings.maxTokens, modalHostname: settings.modalHostname, customBaseUrl: settings.customBaseUrl,
              })
              if (res?.error) throw new Error(res.error)
              output = extractChatText(res)
            } else if (nd.type === 'tool') {
              const tn = nd.config.toolName || 'exec_command'
              if (tn === 'exec_command') {
                const r = await window.electron.execCommand({ command: nd.config.params?.command || '', cwd: projectCwdRef.current })
                output = formatExecResult(r)
              } else if (tn === 'web_search') {
                const r = await window.electron.webSearch(String(nd.config.params?.query || prevOutput).replace(/{{input}}/g, prevOutput))
                output = r.result || r.error || ''
              } else if (tn === 'read_file') {
                const r = await window.electron.readFile(nd.config.params?.filePath || '')
                output = r.content ?? (r.error || '')
              } else if (tn === 'write_file') {
                const content = String(nd.config.params?.content || prevOutput).replace(/{{input}}/g, prevOutput)
                const r = await window.electron.writeFile({ filePath: nd.config.params?.filePath || '', content })
                output = r.error ? `Erro: ${r.error}` : 'arquivo escrito'
              }
            } else if (nd.type === 'condition') {
              const expr = String(nd.config.expression || '')
              const matches = prevOutput.toLowerCase().includes(expr.toLowerCase())
              if (!matches) { entries.push({ label: nd.label, status: 'skipped', output: `condição falsa: "${expr}"` }); continue }
              output = `condição verdadeira: "${expr}"`
            } else if (nd.type === 'output') {
              const dest = nd.config.destination || 'chat'
              if (dest === 'file' && nd.config.filePath) {
                const r = await window.electron.writeFile({ filePath: nd.config.filePath, content: prevOutput })
                output = r.error ? `Erro: ${r.error}` : `salvo em ${nd.config.filePath}`
              } else {
                output = prevOutput // chat/clipboard → o conteúdo vira a saída final
              }
            }
            // condition-true e nós de status preservam o pipe como no painel;
            // output(chat) deixa o conteúdo seguir.
            prevOutput = output
            entries.push({ label: nd.label, status: 'done', output })
          } catch (e: any) {
            entries.push({ label: nd.label, status: 'error', output: e?.message || String(e) })
            break
          }
        }
        return formatWorkflowRun(wf.name, entries, prevOutput)
      }
      if (name === 'set_persona') {
        // Fusão do PersonaEngine (v2.77.0): adota/troca/limpa a persona. Vale a
        // partir da próxima resposta. Ver utils/personas.ts.
        if (!onSetPersonaRef.current) return 'Personas indisponíveis nesta sessão.'
        const wanted = String(args.name ?? '').trim()
        if (!wanted || isClearPersona(wanted)) {
          onSetPersonaRef.current(null)
          return formatSetPersonaResult(null, settings.language || 'pt')
        }
        const persona = findPersona(personasRef.current, wanted)
        if (!persona) {
          const names = (personasRef.current || []).map(p => p.name).filter(Boolean).join(', ')
          return `Persona "${wanted}" não encontrada. Disponíveis: ${names || '(nenhuma)'}. Use "padrão" para limpar.`
        }
        onSetPersonaRef.current(persona)
        return formatSetPersonaResult(persona, settings.language || 'pt')
      }
      if (name === 'fetch_url') {
        const result = await window.electron.fetchUrl(args.url)
        if (result.error) return `Fetch error: ${result.error}`
        const header = [
          result.title ? `# ${result.title}` : '',
          `URL: ${result.url}`,
          result.thin ? '(thin/JS-rendered — if content is missing, use browser_navigate)' : '',
          result.truncated ? '(truncated)' : '',
        ].filter(Boolean).join('\n')
        return `${header}\n\n${result.text || '(empty page)'}`
      }
      if (name === 'project_tree') {
        // Fusão do CodeWorkspace (v2.79.0): estrutura recursiva em uma chamada.
        const dir = resolveExecCwd(args.path, projectCwdRef.current)
        if (!dir) return 'project_tree: informe "path" (ou abra um projeto para usar a pasta ativa).'
        const res = await window.electron.workspaceTree(dir)
        return formatProjectTree(res, dir)
      }
      if (name === 'glob_files') {
        // Copiado do Glob do Claude Code (v2.82.1): acha arquivos por padrão de
        // nome. Reusa o workspace-tree e casa caminhos relativos. Ver utils/glob.ts.
        const pattern = String(args.pattern ?? '').trim()
        if (!pattern) return 'glob_files: faltou o parâmetro "pattern".'
        const dir = resolveExecCwd(args.path, projectCwdRef.current)
        if (!dir) return 'glob_files: informe "path" (ou abra um projeto para usar a pasta ativa).'
        const res = await window.electron.workspaceTree(dir)
        return formatGlobResults(res, pattern, dir)
      }
      if (name === 'search_conversations') {
        // Recall cross-sessão (ideia do FTS5 do Hermes, v2.82.2): scan linear nas
        // conversas em memória, excluindo a ativa. Ver utils/searchConversations.ts.
        const query = String(args.query ?? '').trim()
        if (!query) return 'search_conversations: faltou o parâmetro "query".'
        const all = getConversationsRef.current?.() || []
        const max = Math.min(Math.max(Number(args.max) || 8, 1), 20)
        const matches = searchConversations(all as any, query, { excludeId: convId || undefined, max })
        return formatConversationMatches(matches, query, new Date())
      }
      if (name === 'list_directory') {
        const result = await window.electron.listDirectory(args.path)
        if (result.items) {
          return result.items.map((item: any) =>
            `${item.type === 'directory' ? '[DIR]' : '[FILE]'} ${item.name} (${item.size} bytes, ${item.modified})`
          ).join('\n')
        }
        return result.error || 'Erro ao listar diretorio'
      }
      if (name === 'open_file_or_url') {
        const result = await window.electron.openTarget(args.target)
        return result.error ? `Erro: ${result.error}` : `Aberto: ${args.target}`
      }
      if (name === 'computer_open_app') {
        const r = await window.electron.orionRunAction({ type: 'open_app', params: { app: args.app } })
        return r.error ? `Erro ao abrir "${args.app}": ${r.error}` : `Aberto: ${args.app}`
      }
      if (name === 'computer_type_text') {
        const r = await window.electron.orionRunAction({ type: 'type_text', params: { text: args.text } })
        return r.error ? `Erro ao digitar: ${r.error}` : `Texto digitado.`
      }
      if (name === 'computer_press_keys') {
        const r = await window.electron.orionRunAction({ type: 'key_press', params: { key: args.keys } })
        return r.error ? `Erro ao enviar teclas: ${r.error}` : `Teclas enviadas: ${args.keys}`
      }
      if (name === 'computer_click') {
        // Fusão do ORION (v2.78.0): clique por coordenada no desktop real
        // (reusa o IPC orion-run-action). Ver capture_screen para localizar.
        const x = Math.round(Number(args.x)), y = Math.round(Number(args.y))
        if (!Number.isFinite(x) || !Number.isFinite(y)) return 'computer_click: x e y numéricos são obrigatórios (use capture_screen para localizar).'
        const r = await window.electron.orionRunAction({ type: 'click', params: { x, y } })
        return r.error ? `Erro ao clicar em (${x}, ${y}): ${r.error}` : `Clique em (${x}, ${y}).`
      }
      if (name === 'computer_scroll') {
        const amount = Number.isFinite(Number(args.amount)) ? Math.round(Number(args.amount)) : -3
        const r = await window.electron.orionRunAction({ type: 'scroll', params: { delta: amount } })
        return r.error ? `Erro ao rolar: ${r.error}` : `Rolagem (${amount > 0 ? 'cima' : 'baixo'}, ${Math.abs(amount)}).`
      }
      if (name === 'git_command') {
        const result = await window.electron.gitCommand({ command: args.command, cwd: args.cwd })
        if (result.error) return `Git error: ${result.error}`
        return (result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim() || 'Done (no output)'
      }
      if (name === 'undo_last_write') {
        const result = await window.electron.undoLastWrite()
        return result.error ? `Undo error: ${result.error}` : `File restored: ${result.restored}`
      }
      if (name === 'plan_tasks') {
        const plan: TaskPlan = { goal: args.goal, tasks: args.tasks || [] }
        if (convId) {
          setConversations(prev => prev.map(c => c.id !== convId ? c : { ...c, taskPlan: plan }))
        }
        // Inline "now execute step 1" hint so the model can act on the NEXT
        // message instead of waiting for the separate next-turn nudge — saves
        // a slow round-trip. (The next-turn nudge stays as a fallback.)
        const goNow = settings.language === 'en'
          ? ' Now execute step 1 by calling the appropriate tool in your next message — do not stop and wait.'
          : ' Agora execute o passo 1 chamando a ferramenta apropriada na próxima mensagem — não pare e espere.'
        return `Task plan created: "${args.goal}" with ${plan.tasks.length} subtasks.${goNow}`
      }
      if (name === 'update_task_status') {
        if (convId) {
          setConversations(prev => prev.map(c => {
            if (c.id !== convId || !c.taskPlan) return c
            const tasks = c.taskPlan.tasks.map(t =>
              t.id === args.task_id ? { ...t, status: args.status, result: args.result || t.result } : t
            )
            return { ...c, taskPlan: { ...c.taskPlan, tasks } }
          }))
        }
        return `Task "${args.task_id}" updated to ${args.status}${args.result ? ': ' + args.result : ''}`
      }
      if (name === 'browser_navigate') {
        // Auto-launch browser if not yet started, then navigate.
        // A resilient nav (electron/browser-nav.js) may return `partial: true`
        // when it timed out / hit a redirect but still captured a usable page —
        // surface that to the model so it knows the page may be incomplete
        // instead of silently treating partial content as a full load.
        const fmtNav = (r: any) => formatNavResult(r)
        try {
          const nav = await window.electron.browserNavigate(args.url)
          if (nav.error) {
            // Browser not launched yet — launch and retry
            const launch = await window.electron.browserLaunch()
            if (launch.error) return `Browser launch error: ${launch.error}`
            const retry = await window.electron.browserNavigate(args.url)
            if (retry.error) return `Navigation error: ${retry.error}`
            return fmtNav(retry)
          }
          return fmtNav(nav)
        } catch (e: any) {
          return `Browser error: ${e.message}`
        }
      }
      if (name === 'browser_get_text') {
        const result = await window.electron.browserGetText(args.selector ? { selector: args.selector } : {})
        return result.text || result.error || '(empty page)'
      }
      if (name === 'browser_click') {
        const result = await window.electron.browserClick(args.selector)
        return formatClickResult(result, args.selector)
      }
      if (name === 'browser_type') {
        const result = await window.electron.browserType({
          selector: args.selector,
          text: args.text,
          pressEnter: args.pressEnter,
        })
        return result.success ? `Typed "${args.text}" in: ${args.selector}${args.pressEnter ? ' + Enter' : ''}` : `Type error: ${result.error}`
      }
      if (name === 'browser_wait') {
        const result = await window.electron.browserWait({ selector: args.selector, timeout: args.timeout })
        return result.found ? `Element found: ${args.selector}` : `Element not found within timeout: ${args.selector}`
      }
      if (name === 'browser_get_links') {
        const result = await window.electron.browserGetLinks()
        if (result.error) return `Error: ${result.error}`
        if (!result.links?.length) return 'No links found on page.'
        return `Found ${result.links.length} links:\n${result.links.map((l: any) => `- [${l.text || '(no text)'}](${l.href})`).join('\n')}`
      }
      if (name === 'browser_get_forms') {
        const result = await window.electron.browserGetForms()
        if (result.error) return `Error: ${result.error}`
        if (!result.forms?.length) return 'No form elements found on page.'
        return `Found ${result.forms.length} form elements:\n${result.forms.map((f: any) => `- <${f.tag}> type="${f.type}" name="${f.name}" placeholder="${f.placeholder}" → selector: "${f.selector}"`).join('\n')}`
      }
      if (name === 'browser_screenshot') {
        const result = await window.electron.browserScreenshot()
        if (result.error) return `Screenshot error: ${result.error}`
        const kb = Math.round((result.size || 0) / 1024)
        const dims = result.width && result.height ? `${result.width}×${result.height}` : 'viewport'
        // Honest result: the image is shown in the app's browser window (for the
        // human); the chat model does not receive the pixels here. Steer it to
        // the text tools it CAN read, and give the viewport size click_at needs.
        return `Screenshot captured: ${dims}, ${kb}KB JPEG (shown in the browser window). To read page content use browser_get_text or browser_get_forms; to interact by coordinates use browser_click_at (x,y) within ${dims}.`
      }
      // ─── Computer Use (vision-based coordinate interaction) ───────────────
      if (name === 'browser_click_at') {
        const result = await window.electron.browserClickAt({ x: args.x, y: args.y })
        if (result.error) return `Click error: ${result.error}`
        return `Clicked at (${result.x}, ${result.y})`
      }
      if (name === 'browser_type_text') {
        const result = await window.electron.browserTypeText({ text: args.text, pressEnter: args.pressEnter })
        if (result.error) return `Type error: ${result.error}`
        return `Typed "${args.text}"${args.pressEnter ? ' + Enter' : ''}`
      }
      if (name === 'browser_key_press') {
        const result = await window.electron.browserKeyPress({ key: args.key, modifiers: args.modifiers })
        if (result.error) return `Key press error: ${result.error}`
        const mods = args.modifiers?.length ? `${args.modifiers.join('+')}+` : ''
        return `Pressed ${mods}${args.key}`
      }
      if (name === 'browser_scroll') {
        const result = await window.electron.browserScroll({
          deltaY: args.deltaY,
          deltaX: args.deltaX,
          x: args.x,
          y: args.y,
        })
        if (result.error) return `Scroll error: ${result.error}`
        return `Scrolled (dx=${args.deltaX || 0}, dy=${args.deltaY || 0})`
      }
      if (name === 'delegate_subtasks') {
        // ── Research workers (v2.63.0): cada subagente roda seu PRÓPRIO loop de
        // ferramentas de LEITURA (web_search/fetch_url/read_file/search_files/
        // list_directory) e devolve uma síntese. Workers no Ollama local por
        // padrão (paralelo + grátis; split orquestrador-worker) — ver
        // researchWorker.ts. Modal-pool é opt-in.
        const lang = settings.language || 'pt'
        const systemMsg = settings.systemPrompt || ''
        const LANGUAGE_RULE: Record<string, string> = {
          pt: '\n\nIMPORTANTE: Responda SEMPRE em português do Brasil.',
          en: '\n\nIMPORTANT: Always respond in English.',
        }
        const langRule = LANGUAGE_RULE[lang] ?? LANGUAGE_RULE.pt
        const finalNudge = lang === 'en'
          ? 'Step budget reached. Stop using tools and give your final synthesis now, based on what you gathered.'
          : 'Limite de passos atingido. Pare de usar ferramentas e dê agora sua síntese final, com base no que coletou.'

        const subtasks = (args.subtasks || []).filter((s: any) => s && s.prompt)
        if (!subtasks.length) return 'Nenhuma subtarefa válida fornecida.'

        // Subagentes ANINHADOS (v2.88.0): teto de profundidade da árvore. 1 = sem
        // aninhamento (clássico); 2+ = um worker pode abrir sub-workers. Ver
        // researchWorker.canDelegateAtDepth / makeWorkerExec abaixo.
        const maxDepth = normalizeMaxDepth(settings.subagentMaxDepth)
        // Mensagens/ferramentas dependem da profundidade: o prompt ganha a
        // cláusula de delegação e a allowlist ganha delegate_subtasks só enquanto
        // ainda dá para aninhar.
        const buildMessages = (st: any, depth: number): WorkerMessage[] => {
          const rolePrompt = resolveSubagentPrompt(st.agent)
          const sys = [workerSystemPrompt(lang, canDelegateAtDepth(depth, maxDepth)), rolePrompt, systemMsg]
            .filter(Boolean).join('\n\n') + langRule
          return [{ role: 'system', content: sys }, { role: 'user', content: String(st.prompt ?? '') }]
        }

        // Multi-modelo (v2.64.0): cada worker Ollama pode usar um modelo
        // diferente — o orquestrador escolhe por subtarefa (campo "model",
        // validado contra a lista permitida) ou faz rodízio. Ver
        // resolveSubagentModel.
        const allowedModels = (settings.subagentModels || []).map(s => String(s).trim()).filter(Boolean)
        const fallbackModel = settings.subagentModel || 'llama3.2'
        // Timeout por-passo CONFIGURÁVEL (v2.66.0). É só uma rede de segurança
        // contra um Ollama TRAVADO — não um limite de trabalho. Default generoso
        // (600s/passo); 0 = sem limite (respeitando quem deleta tarefas grandes,
        // com o caveat de que um Ollama realmente preso volta a congelar).
        const stepTimeoutMs = Math.max(0, Math.round((settings.subagentTimeoutSec ?? 600) * 1000))
        const makeOllamaChat = (model: string): WorkerChat => async (messages, tools) => {
          try {
            const r = await window.electron.ollamaChat({
              model, messages, tools,
              temperature: settings.temperature,
              max_tokens: settings.maxTokens,
              numCtx: settings.ollamaNumCtx,
              timeoutMs: stepTimeoutMs, // 0 → sem timeout no handler
            })
            return normalizeWorkerChat(r)
          } catch (e: any) { return { content: '', toolCalls: [], error: e?.message || 'ollama error' } }
        }
        const makeModalChat = (apiKey: string): WorkerChat => async (messages, tools) => {
          try {
            const [res] = await window.electron.providerParallelChat({
              tasks: [{ id: 'w', messages, tools, apiKey }],
              provider: 'modal',
              model: settings.modalModel || selectedModel || 'zai-org/GLM-5.1-FP8',
              hostname: settings.modalHostname,
              temperature: settings.temperature,
              max_tokens: settings.maxTokens,
            })
            return normalizeWorkerChat(res?.result, res?.error || undefined)
          } catch (e: any) { return { content: '', toolCalls: [], error: e?.message || 'modal error' } }
        }

        const useModal = settings.subagentExecutor === 'modal'
          && settings.provider === 'modal' && !!modalKeyPool && modalKeyPool.totalCount > 0

        const batchTag = Date.now().toString(36)
        // `depth` = nível na árvore (1 = worker direto do orquestrador).
        // `parentRunId` fecha a árvore no painel. Mutuamente recursivo com o
        // childExec abaixo (filhos rodam via runOne em depth+1).
        const runOne = (st: any, index: number, depth = 1, parentRunId?: string) => async (): Promise<string> => {
          const runId = parentRunId ? `${parentRunId}.${index}` : `${batchTag}-${index}`
          const taskLabel = String(st.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
          const myTools = buildWorkerToolsForDepth(TOOLS as any, depth, maxDepth)

          // Executor deste worker. Subagentes ANINHADOS (v2.88.0): se ele pedir
          // delegate_subtasks (só ofertado enquanto a profundidade permite), os
          // FILHOS rodam SEQUENCIALMENTE dentro da vaga já segurada por este
          // worker — NÃO pegam nova vaga do semáforo. Isso evita deadlock (pai
          // esperando filho que espera vaga que o pai segura) e mantém a carga
          // simultânea de Ollama ≤ teto global. Fora isso, só a allowlist de
          // leitura roda (fronteira de segurança rígida).
          const myExec: WorkerExec = async (n, a) => {
            if (n === DELEGATE_TOOL_NAME) {
              if (!canDelegateAtDepth(depth, maxDepth)) {
                return lang === 'en'
                  ? `[Max subagent depth (${maxDepth}) reached — do not delegate further; synthesize with what you have.]`
                  : `[Profundidade máxima de subagentes (${maxDepth}) atingida — não delegue mais; sintetize com o que tem.]`
              }
              const childTasks = capNestedSubtasks((a?.subtasks || []).filter((s: any) => s && s.prompt))
              if (!childTasks.length) {
                return lang === 'en' ? '[delegate_subtasks: no valid subtask.]' : '[delegate_subtasks: nenhuma subtarefa válida.]'
              }
              const childOut = await runWithConcurrency(
                childTasks.map((cst: any, ci: number) => runOne(cst, ci, depth + 1, runId)), 1)
              return childOut.join('\n\n---\n\n')
            }
            return WORKER_TOOL_NAMES.has(n)
              ? executeToolRaw(n, a)
              : `[A ferramenta "${n}" não está disponível para subagentes. Use só leitura/pesquisa: ${[...WORKER_TOOL_NAMES].join(', ')}.]`
          }

          let chat: WorkerChat
          let slot: { key: string } | null = null
          let modelUsed: string
          let onOllama = false
          // Modal só na RAIZ (depth 1): os filhos aninhados sempre rodam no
          // Ollama local (evita esgotar o pool de keys e o mesmo risco de
          // deadlock no pool; e o split orquestrador-worker já cobriu a raiz).
          if (useModal && depth === 1) {
            slot = await modalKeyPool!.acquireOrWait()
            modelUsed = settings.modalModel || selectedModel || 'zai-org/GLM-5.1-FP8'
            if (slot) chat = makeModalChat(slot.key)
            else if (settings.modalPoolFallbackOllama) {
              modelUsed = resolveSubagentModel(st.model, index, allowedModels, fallbackModel)
              chat = makeOllamaChat(modelUsed); onOllama = true
            } else return `[Agent ${st.id ?? '?'}]: [pool Modal esgotado]`
          } else {
            modelUsed = resolveSubagentModel(st.model, index, allowedModels, fallbackModel)
            chat = makeOllamaChat(modelUsed); onOllama = true
          }
          // Worker recebeu a ordem → aparece no painel como "trabalhando".
          subagentActivity?.start(runId, taskLabel, modelUsed, Date.now(), depth, parentRunId)
          let errored = false
          try {
            let out = await runResearchWorker({
              messages: buildMessages(st, depth), tools: myTools, chat, exec: myExec, finalNudge,
              onProgress: (p) => subagentActivity?.progress(runId, p.step, p.toolsUsed, p.lastTool),
            })
            // Retry-com-fallback (v2.83.1): se o worker Ollama falhou no modelo
            // atribuído (ex.: 9b não coube na VRAM sob concorrência), tenta 1×
            // em OUTRO modelo da lista (um menor que cabe), não num fallback fixo
            // que pode nem estar instalado. Recupera o subtask em vez de "falhou".
            if (out.error && onOllama) {
              const retryModel = pickFallbackModel(modelUsed, allowedModels, fallbackModel)
              if (retryModel) {
                subagentActivity?.start(runId, taskLabel, `${retryModel} (fallback)`, Date.now(), depth, parentRunId)
                const out2 = await runResearchWorker({
                  messages: buildMessages(st, depth), tools: myTools, chat: makeOllamaChat(retryModel), exec: myExec, finalNudge,
                  onProgress: (p) => subagentActivity?.progress(runId, p.step, p.toolsUsed, p.lastTool),
                })
                if (!out2.error) { out = out2; modelUsed = `${retryModel} (fallback)` }
              }
            }
            errored = !!out.error
            if (errored) subagentActivity?.fail(runId, out.text, Date.now())
            else subagentActivity?.finish(runId, out.text, out.steps, out.toolsUsed, Date.now())
            const bits = [`${out.steps}↻`, modelUsed]
            if (out.toolsUsed.length) bits.push(summarizeToolsUsed(out.toolsUsed))
            return `[Agent ${st.id ?? '?'}]: _(${bits.join(' · ')})_\n${out.text}`
          } catch (e: any) {
            errored = true
            subagentActivity?.fail(runId, `[erro: ${e?.message || e}]`, Date.now())
            return `[Agent ${st.id ?? '?'}]: [erro: ${e?.message || e}]`
          } finally {
            if (slot) errored ? modalKeyPool!.markError(slot.key, 'worker error') : modalKeyPool!.release(slot.key)
          }
        }

        // Concorrência GLOBAL dos workers Ollama (v2.67.0): um semáforo limita
        // quantos rodam AO MESMO TEMPO em todo o app (entre lotes/turnos), pra
        // muitos modelos locais não engarrafarem/travarem a máquina. Modal usa
        // o pool de keys (cloud, sem trava local).
        const maxConc = Math.max(1, Number(settings.subagentConcurrency) || 2)
        if (!useModal && subagentLimiter) subagentLimiter.setMax(maxConc)

        // Controle de ADMISSÃO: se o limite já está ocupado (por lotes/turnos
        // anteriores ainda rodando), NÃO aceita nova delegação — manda a IA
        // principal aguardar uma vaga em vez de empilhar e congelar.
        if (!useModal && subagentLimiter && (subagentLimiter.running >= maxConc || subagentLimiter.waiting > 0)) {
          return lang === 'en'
            ? `⚠️ ${subagentLimiter.running} subagent(s) already working and ${subagentLimiter.waiting} queued (limit ${maxConc} at a time). Do NOT delegate more now — wait for them to deliver (their results arrive automatically), then delegate again, or do other work meanwhile.`
            : `⚠️ Já há ${subagentLimiter.running} subagente(s) trabalhando e ${subagentLimiter.waiting} na fila (limite ${maxConc} por vez). NÃO delegue mais agora — aguarde eles entregarem (os resultados chegam sozinhos) e então delegue de novo, ou faça outro trabalho enquanto isso.`
        }

        // Executa o lote: Modal mantém o cap por key-pool; Ollama passa pelo
        // semáforo global (≤maxConc concorrentes em todo o app).
        const runBatch = (): Promise<string[]> => {
          if (useModal) {
            return runWithConcurrency(subtasks.map((st: any, i: number) => runOne(st, i)), Math.min(modalKeyPool!.totalCount, subtasks.length))
          }
          if (subagentLimiter) {
            const lim = subagentLimiter
            return Promise.all(subtasks.map((st: any, i: number) => lim.run(() => runOne(st, i)())))
          }
          return runWithConcurrency(subtasks.map((st: any, i: number) => runOne(st, i)), maxConc)
        }

        // Modo BACKGROUND (v2.65.0): dispara sem await, registra o lote e devolve
        // na hora um handle — a IA principal segue trabalhando; useChat injeta o
        // resultado quando pronto (e drena no fim do turno). Ligado pelo toggle
        // global OU pelo parâmetro `background` que o modelo escolhe.
        const background = (settings.subagentsBackground === true || args.background === true) && !!backgroundTasks
        if (background) {
          const work = runBatch().then((rs) => rs.join('\n\n---\n\n'))
          const id = backgroundTasks!.register(`${subtasks.length} subtarefa(s)`, work)
          return lang === 'en'
            ? `🚀 Delegated ${subtasks.length} subtask(s) to BACKGROUND subagents (batch ${id}, ${maxConc} running at a time). They are running now; CONTINUE with other useful work — their results will be injected automatically when ready (and awaited before you finish if still pending). Do NOT stop and wait.`
            : `🚀 Deleguei ${subtasks.length} subtarefa(s) a subagentes em BACKGROUND (lote ${id}, ${maxConc} por vez). Eles estão rodando agora; CONTINUE com outro trabalho útil — os resultados serão injetados automaticamente quando prontos (e aguardados antes de você concluir, se ainda pendentes). NÃO pare para esperar.`
        }

        const results = await runBatch()
        return results.join('\n\n---\n\n')
      }
      return 'Ferramenta nao reconhecida'
    } catch (e: any) {
      return `Erro: ${e.message}`
    }
  }, [setConversations, settings, selectedModel, modalKeyPool])

  const requestApproval = useCallback((toolName: string, args: Record<string, any>): Promise<boolean> => {
    return new Promise((resolve) => {
      // Wrap resolve so multiple clicks on allow/deny before React clears
      // the banner can't fire conflicting outcomes. The first decision wins;
      // subsequent clicks are no-ops.
      let settled = false
      const safeResolve = (v: boolean) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      setPendingApproval({ toolName, args, resolve: safeResolve })
    })
  }, [])

  const executeTool = useCallback(async (name: string, args: Record<string, any>): Promise<string> => {
    const convId = activeConvIdRef.current
    const level = settings.permissionLevel || 'ask'
    // Risky desktop actions (open app, Ctrl/Alt shortcuts, Alt+F4…) ALWAYS
    // confirm first — even in bypass mode — because they act on the user's real
    // machine. Common desktop actions (plain typing/navigation) run free.
    const needsApproval = toolNeedsApproval(level, name) || isRiskyDesktopAction(name, args)

    if (needsApproval) {
      const approved = await requestApproval(name, args)
      if (!approved) {
        window.electron.auditLogAppend({ tool: name, args, status: 'denied', output: '' }).catch(e => console.warn('[toolExec] audit error:', e))
        logInsight('tool', 'denied', { name })
        return `[USER DENIED]: The user rejected execution of "${name}". Try a different approach or ask the user what they prefer.`
      }
    }

    // Hooks PreToolUse (v2.44.0): rodam ANTES da tool. Se algum sair com código
    // ≠ 0, a tool é BLOQUEADA (guardrail determinístico, ex.: barrar edição de
    // arquivo sensível). O hook recebe nome/args via env.
    if (name !== 'execute_command') {
      const preHooks = matchHooks(settings.hooks, 'PreToolUse', name)
      for (const hook of preHooks) {
        try {
          const r = await window.electron.execCommand({
            command: hook.command,
            cwd: projectCwdRef.current,
            timeoutMs: 30000,
            env: { OPENCLAUDE_TOOL_NAME: name, OPENCLAUDE_TOOL_ARGS: JSON.stringify(args || {}).slice(0, 4000) },
          })
          if ((r?.exitCode ?? 0) !== 0) {
            const why = [r?.stderr, r?.stdout].filter(Boolean).join('\n').trim().slice(0, 800)
            logInsight('tool', 'denied', { name, hook: true })
            return `[BLOCKED BY HOOK]: o hook PreToolUse "${hook.command}" bloqueou "${name}" (exit ${r?.exitCode}).${why ? '\n' + why : ''}\nAjuste a abordagem ou peça ao usuário.`
          }
        } catch (e: any) {
          // Falha ao rodar o hook não bloqueia (best-effort), só registra.
          console.warn('[toolExec] PreToolUse hook error:', e?.message)
        }
      }
    }

    const startTime = Date.now()
    let out = await executeToolRaw(name, args)
    const duration = Date.now() - startTime
    const failed = isToolError(out, name)
    logInsight('tool', 'use', { name, ok: !failed })

    // Hooks PostToolUse (v2.38.0): após uma tool concluir COM SUCESSO, roda os
    // comandos configurados que casam (ex.: lint/format/test após edit_file) e
    // anexa a saída ao resultado — o modelo vê erros de lint/teste na hora.
    if (!failed && name !== 'execute_command') {
      const hooks = matchHooks(settings.hooks, 'PostToolUse', name)
      for (const hook of hooks) {
        try {
          const r = await window.electron.execCommand({ command: hook.command, cwd: projectCwdRef.current, timeoutMs: 60000 })
          const text = [r?.stdout, r?.stderr].filter(Boolean).join('\n').trim()
          const tag = `[hook PostToolUse: ${hook.command}]`
          out += text
            ? `\n\n${tag}\n${text.slice(0, 1500)}`
            : `\n\n${tag} (ok, sem saída)`
        } catch (e: any) {
          out += `\n\n[hook error: ${hook.command}] ${e?.message || 'falha'}`
        }
      }
    }

    window.electron.auditLogAppend({
      tool: name,
      args,
      status: failed ? 'error' : 'success',
      output: out.substring(0, 500),
      duration,
      conversationId: convId,
    }).catch(e => console.warn('[toolExec] audit error:', e))

    // headroom nativo (v2.72.0): comprime a redundância da saída ANTES de
    // truncar, então mais sinal real cabe no orçamento de tokens.
    const compacted = settings.compressToolOutputs !== false ? compressOutput(out).text : out
    return truncateToolOutput(compacted)
  }, [settings, executeToolRaw, requestApproval])

  // ── Scout proativo (v2.69.0): roda UM worker de pesquisa sobre `topic`,
  // focado em dados ATUAIS (hoje) + caminhos alternativos. Só pega vaga OCIOSA
  // do semáforo (tryAcquire → nunca bloqueia delegações); abortável via signal
  // (pausa quando a IA delega). Reporta ao painel. Ver scout.ts / useChat.
  const runScout = useCallback(async (topic: string, signal: AbortSignal): Promise<string | null> => {
    if (signal.aborted) return null
    if (!subagentLimiter || !subagentLimiter.tryAcquire()) return null // sem vaga ociosa agora
    const lang = settings.language || 'pt'
    const today = new Date().toISOString().slice(0, 10)
    const allowedModels = (settings.subagentModels || []).map(s => String(s).trim()).filter(Boolean)
    const model = resolveSubagentModel(undefined, scoutSeqRef.current, allowedModels, settings.subagentModel || 'llama3.2')
    const timeoutSec = settings.subagentTimeoutSec ?? 600
    const runId = `scout_${Date.now()}_${++scoutSeqRef.current}`
    const workerTools = buildWorkerTools(TOOLS as any)
    const workerExec: WorkerExec = async (n, a) =>
      WORKER_TOOL_NAMES.has(n) ? executeToolRaw(n, a) : `[indisponível para o scout: ${n}]`
    // Fábrica de chat por modelo (v2.86.1): permite retry-com-fallback se o
    // modelo atribuído falhar (ex.: 9b não cabe na VRAM — mesma causa das
    // falhas do delegate_subtasks).
    const makeChat = (m: string): WorkerChat => async (messages, tools) => {
      try {
        const r = await window.electron.ollamaChat({
          model: m, messages, tools,
          temperature: settings.temperature, max_tokens: settings.maxTokens,
          numCtx: settings.ollamaNumCtx, timeoutMs: timeoutSec > 0 ? timeoutSec * 1000 : 0,
        })
        return normalizeWorkerChat(r)
      } catch (e: any) { return { content: '', toolCalls: [], error: e?.message || 'ollama error' } }
    }
    const userMsg = lang === 'en'
      ? `What the main AI is currently doing: ${topic}\n\nResearch the MOST CURRENT info (today, ${today}) and faster alternative paths for this. Deliver only what is new/current/useful.`
      : `O que a IA principal está fazendo agora: ${topic}\n\nPesquise a informação MAIS ATUAL (hoje, ${today}) e caminhos alternativos mais rápidos para isso. Entregue só o que for novo/atual/útil.`
    const messages: WorkerMessage[] = [
      { role: 'system', content: scoutSystemPrompt(lang, today) },
      { role: 'user', content: userMsg },
    ]
    subagentActivity?.start(runId, `🔭 ${topic.slice(0, 70)}`, model, Date.now())
    try {
      const runOpts = {
        messages, tools: workerTools, exec: workerExec,
        finalNudge: lang === 'en' ? 'Summarize the most current, useful findings now.' : 'Resuma agora os achados mais atuais e úteis.',
        isStopped: () => signal.aborted,
        onProgress: (p: { step: number; toolsUsed: string[]; lastTool?: string }) => subagentActivity?.progress(runId, p.step, p.toolsUsed, p.lastTool),
      }
      let out = await runResearchWorker({ ...runOpts, chat: makeChat(model) })
      // Retry-com-fallback (v2.86.1): se falhou (e não foi pausa), tenta 1× em
      // OUTRO modelo da lista (um menor que cabe na VRAM) — igual ao delegate.
      if (out.error && !signal.aborted) {
        const fb = pickFallbackModel(model, allowedModels, settings.subagentModel || 'llama3.2')
        if (fb) {
          subagentActivity?.start(runId, `🔭 ${topic.slice(0, 70)}`, `${fb} (fallback)`, Date.now())
          const out2 = await runResearchWorker({ ...runOpts, chat: makeChat(fb) })
          if (!out2.error) out = out2
        }
      }
      if (signal.aborted) { subagentActivity?.fail(runId, lang === 'en' ? '[paused]' : '[pausado]', Date.now()); return null }
      if (out.error) { subagentActivity?.fail(runId, out.text, Date.now()); return null }
      subagentActivity?.finish(runId, out.text, out.steps, out.toolsUsed, Date.now())
      return out.text
    } catch (e: any) {
      subagentActivity?.fail(runId, `[erro: ${e?.message || e}]`, Date.now())
      return null
    } finally {
      subagentLimiter.release()
    }
  }, [settings, subagentLimiter, subagentActivity, executeToolRaw])

  return { pendingApproval, setPendingApproval, executeTool, executeToolRaw, runScout }
}
