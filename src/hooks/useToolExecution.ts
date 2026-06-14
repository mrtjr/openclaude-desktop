import { useState, useCallback, useRef } from 'react'
import type { AppSettings, PendingApproval, TaskPlan, Conversation } from '../types'
import { TOOLS } from '../constants/tools'
import { resolveToolSearch, formatToolSearchResult } from '../services/toolDeferral'
import { toolNeedsApproval, truncateToolOutput, isToolError } from '../utils/toolPolicy'
import { formatExecResult, resolveExecCwd, resolveExecTimeoutMs } from '../utils/execResult'
import { formatEditResult, formatWriteResult, COACH_REWRITE_MIN_CHARS } from '../utils/editResult'
import { mergeFact } from '../utils/persistentMemory'
import { parseSearchGlob, formatSearchResults } from '../utils/searchFiles'
import { isRiskyDesktopAction } from '../utils/desktopPolicy'
import { paginateFileContent } from '../utils/readFile'
import { formatClickResult, formatNavResult } from '../utils/browserResult'
import { logInsight } from '../services/devInsights'
import { findSkill, formatLoadSkillResult } from '../utils/skills'
import type { Skill } from '../types/skill'
import type { ModalKeyPool } from './useModalKeyPool'
import type { ParallelChatResult, ParallelChatTask } from '../types/ipc'

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
}

export function useToolExecution({ settings, activeConvId, setConversations, selectedModel, modalKeyPool, projectCwd, skills }: UseToolExecutionOptions) {
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)

  // Use refs to avoid stale closures
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId
  const projectCwdRef = useRef(projectCwd)
  projectCwdRef.current = projectCwd
  const skillsRef = useRef(skills)
  skillsRef.current = skills

  const executeToolRaw = useCallback(async (name: string, args: Record<string, any>): Promise<string> => {
    const convId = activeConvIdRef.current
    try {
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
      if (name === 'read_file') {
        const result = await window.electron.readFile(args.path)
        if (result.content == null) return result.error || ''
        return paginateFileContent(result.content, args.offset, args.limit)
      }
      if (name === 'write_file') {
        const content = String(args.content ?? '')
        const result = await window.electron.writeFile({ filePath: args.path, content: args.content })
        // Anti-padrão medido pelos Dev Insights: reescrita total de arquivo
        // existente (era para ser edit_file). O finding 'prefer-edit-file'
        // agrega estes eventos.
        if (!result.error && result.existed && content.length >= COACH_REWRITE_MIN_CHARS) {
          logInsight('tool', 'rewrite_existing', { bytes: content.length })
        }
        return formatWriteResult(result, args.path, content.length)
      }
      if (name === 'edit_file') {
        const result = await window.electron.editFile({ filePath: args.path, oldString: args.old_string, newString: args.new_string ?? '' })
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
      if (name === 'web_search') {
        const result = await window.electron.webSearch(args.query)
        return result.result || result.error || 'Sem resultados'
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
        const lang = settings.language || 'pt'
        const systemMsg = settings.systemPrompt || ''
        const LANGUAGE_RULE: Record<string, string> = {
          pt: '\n\nIMPORTANTE: Responda SEMPRE em português do Brasil.',
          en: '\n\nIMPORTANT: Always respond in English.'
        }
        const buildTask = (st: any): ParallelChatTask => ({
          id: st.id,
          messages: [
            ...(systemMsg ? [{ role: 'system', content: systemMsg + (LANGUAGE_RULE[lang] ?? LANGUAGE_RULE.pt) }] : []),
            { role: 'user', content: st.prompt }
          ]
        })
        const subtasks: ParallelChatTask[] = (args.subtasks || []).map(buildTask)

        // Modal pool path: worker-pool dispatcher
        // N workers (N = active keys) pulling from a shared queue.
        // If there are more tasks than keys, the extras queue up and are picked
        // by whichever worker finishes first — no deadlock, no "pool exhausted".
        if (settings.provider === 'modal' && modalKeyPool && modalKeyPool.totalCount > 0) {
          const queue: ParallelChatTask[] = [...subtasks]
          const resultsMap = new Map<string, ParallelChatResult>()
          const workerCount = Math.min(modalKeyPool.totalCount, subtasks.length)

          const runWorker = async () => {
            while (queue.length > 0) {
              const task = queue.shift()
              if (!task) break
              const slot = await modalKeyPool.acquireOrWait()
              if (!slot) {
                // Fallback per-task: Ollama if enabled, else error
                if (settings.modalPoolFallbackOllama) {
                  const [res] = await window.electron.parallelChat({
                    tasks: [task],
                    model: 'llama3',
                    temperature: settings.temperature,
                    max_tokens: settings.maxTokens,
                  })
                  resultsMap.set(task.id, res)
                } else {
                  resultsMap.set(task.id, { id: task.id, result: null, error: 'Pool exhausted (acquire timeout)' })
                }
                continue
              }
              try {
                const [res] = await window.electron.providerParallelChat({
                  tasks: [{ ...task, apiKey: slot.key }],
                  provider: 'modal',
                  model: settings.modalModel || selectedModel || 'zai-org/GLM-5.1-FP8',
                  hostname: settings.modalHostname,
                  temperature: settings.temperature,
                  max_tokens: settings.maxTokens,
                })
                if (res?.error) modalKeyPool.markError(slot.key, res.error)
                else modalKeyPool.release(slot.key)
                resultsMap.set(task.id, res)
              } catch (e: any) {
                modalKeyPool.markError(slot.key, e?.message || 'dispatch error')
                resultsMap.set(task.id, { id: task.id, result: null, error: e?.message || 'dispatch error' })
              }
            }
          }

          await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

          // Preserve original subtask ordering in the output
          return subtasks.map((st) => {
            const r = resultsMap.get(st.id)
            const content = r?.result?.choices?.[0]?.message?.content || r?.error || 'No response'
            return `[Agent ${st.id}]: ${content}`
          }).join('\n\n---\n\n')
        }

        // Default path: Ollama local
        const results = await window.electron.parallelChat({
          tasks: subtasks,
          model: selectedModel || 'llama3',
          temperature: settings.temperature,
          max_tokens: settings.maxTokens
        })
        return results.map((r) => {
          const content = r.result?.choices?.[0]?.message?.content || r.error || 'No response'
          return `[Agent ${r.id}]: ${content}`
        }).join('\n\n---\n\n')
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

    const startTime = Date.now()
    const out = await executeToolRaw(name, args)
    const duration = Date.now() - startTime
    const failed = isToolError(out, name)
    logInsight('tool', 'use', { name, ok: !failed })

    window.electron.auditLogAppend({
      tool: name,
      args,
      status: failed ? 'error' : 'success',
      output: out.substring(0, 500),
      duration,
      conversationId: convId,
    }).catch(e => console.warn('[toolExec] audit error:', e))

    return truncateToolOutput(out)
  }, [settings, executeToolRaw, requestApproval])

  return { pendingApproval, setPendingApproval, executeTool, executeToolRaw }
}
