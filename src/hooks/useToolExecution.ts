import { useState, useCallback, useRef } from 'react'
import type { AppSettings, PendingApproval, TaskPlan, Conversation } from '../types'
import { SAFE_TOOLS, DANGEROUS_TOOLS } from '../constants/tools'
import type { ModalKeyPool } from './useModalKeyPool'
import type { ParallelChatResult, ParallelChatTask } from '../types/ipc'

interface UseToolExecutionOptions {
  settings: AppSettings
  activeConvId: string | null
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  selectedModel?: string
  modalKeyPool?: ModalKeyPool
}

export function useToolExecution({ settings, activeConvId, setConversations, selectedModel, modalKeyPool }: UseToolExecutionOptions) {
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)

  // Use refs to avoid stale closures
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId

  const executeToolRaw = useCallback(async (name: string, args: Record<string, any>): Promise<string> => {
    const convId = activeConvIdRef.current
    try {
      if (name === 'execute_command') {
        const result = await window.electron.execCommand(args.command)
        return result.stdout || result.stderr || result.error || 'Comando executado'
      }
      if (name === 'read_file') {
        const result = await window.electron.readFile(args.path)
        return result.content || result.error || ''
      }
      if (name === 'write_file') {
        const result = await window.electron.writeFile({ filePath: args.path, content: args.content })
        return result.error ? `Erro: ${result.error}` : 'Arquivo escrito com sucesso'
      }
      if (name === 'web_search') {
        const result = await window.electron.webSearch(args.query)
        return result.result || result.error || 'Sem resultados'
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
        return `Task plan created: "${args.goal}" with ${plan.tasks.length} subtasks.`
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
        // Try navigating first; if it fails, launch browser then retry
        try {
          const nav = await window.electron.browserNavigate(args.url)
          if (nav.error) throw new Error(nav.error)
          const text = await window.electron.browserGetText()
          return `Navigated to: ${nav.title} (${nav.url})\n\nPage content:\n${text.text || '(empty)'}`
        } catch {
          const launch = await window.electron.browserLaunch()
          if (launch.error) return `Browser launch error: ${launch.error}`
          const nav = await window.electron.browserNavigate(args.url)
          if (nav.error) return `Navigation error: ${nav.error}`
          const text = await window.electron.browserGetText()
          return `Navigated to: ${nav.title} (${nav.url})\n\nPage content:\n${text.text || '(empty)'}`
        }
      }
      if (name === 'browser_get_text') {
        const result = await window.electron.browserGetText()
        return result.text || result.error || '(empty page)'
      }
      if (name === 'browser_click') {
        const result = await window.electron.browserClick(args.selector)
        return result.success ? `Clicked: ${args.selector}` : `Click error: ${result.error}`
      }
      if (name === 'browser_type') {
        const result = await window.electron.browserType({ selector: args.selector, text: args.text })
        return result.success ? `Typed in: ${args.selector}` : `Type error: ${result.error}`
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
            ...(systemMsg ? [{ role: 'system', content: systemMsg + LANGUAGE_RULE[lang] }] : []),
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
      setPendingApproval({ toolName, args, resolve })
    })
  }, [])

  const executeTool = useCallback(async (name: string, args: Record<string, any>): Promise<string> => {
    const convId = activeConvIdRef.current
    const level = settings.permissionLevel || 'ask'
    let needsApproval = false

    if (level === 'ask') {
      needsApproval = DANGEROUS_TOOLS.has(name)
    } else if (level === 'auto_edits') {
      const editTools = new Set(['write_file', 'git_command', 'undo_last_write'])
      needsApproval = DANGEROUS_TOOLS.has(name) && !editTools.has(name)
    } else if (level === 'planning') {
      needsApproval = DANGEROUS_TOOLS.has(name)
    } else if (level === 'ignore') {
      needsApproval = false
    }

    if (needsApproval) {
      const approved = await requestApproval(name, args)
      if (!approved) {
        window.electron.auditLogAppend({ tool: name, args, status: 'denied', output: '' }).catch(e => console.warn('[toolExec] audit error:', e))
        return `[USER DENIED]: The user rejected execution of "${name}". Try a different approach or ask the user what they prefer.`
      }
    }

    const startTime = Date.now()
    const out = await executeToolRaw(name, args)
    const duration = Date.now() - startTime

    window.electron.auditLogAppend({
      tool: name,
      args,
      status: out.startsWith('Erro:') || out.startsWith('[SYSTEM INTERCEPT]') ? 'error' : 'success',
      output: out.substring(0, 500),
      duration,
      conversationId: convId,
    }).catch(e => console.warn('[toolExec] audit error:', e))

    if (out && out.length > 4000) {
      return out.substring(0, 2000) +
        `\n\n...[SYSTEM TRUNCATED: Output too large. Original size was ${out.length} characters. Showing start and end only.]...\n\n` +
        out.substring(out.length - 1500)
    }

    return out
  }, [settings, executeToolRaw, requestApproval])

  return { pendingApproval, setPendingApproval, executeTool, executeToolRaw }
}
