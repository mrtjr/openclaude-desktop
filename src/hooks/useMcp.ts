import { useState, useEffect, useRef, useCallback } from 'react'
import type { McpServer } from '../settingsConfig'
import {
  sanitizeServerId, parseCommand, serverToolsToDefs, parseMcpToolName, validateToolArgs,
  type McpToolDef,
} from '../utils/mcpTools'

export interface McpServerStatus {
  id: string
  name: string
  connected: boolean
  toolCount: number
  error?: string
}

/**
 * Liga o MCP ponta a ponta (v2.35.0): conecta nos servidores configurados em
 * Settings, descobre as tools de cada um (`tools/list`) e as expõe ao modelo no
 * formato de function-tool, namespaced `mcp__<servidor>__<tool>`. As chamadas
 * `mcp__*` do modelo são roteadas de volta para `mcp-call-tool`. Até aqui o app
 * tinha UI + backend MCP, mas as tools nunca chegavam ao agente.
 */
export function useMcp(mcpServers: McpServer[] | undefined, enabled: boolean = true) {
  const [mcpTools, setMcpTools] = useState<McpToolDef[]>([])
  // Espelho p/ o callMcpTool (useCallback estável) validar args contra o schema.
  const mcpToolsRef = useRef<McpToolDef[]>([])
  mcpToolsRef.current = mcpTools
  const [status, setStatus] = useState<McpServerStatus[]>([])
  // serverId → toolName real (sem namespace) → para rotear a chamada de volta.
  const connectedRef = useRef<Set<string>>(new Set())
  // Reconexão automática (v2.122.0): config dos servidores + contador de
  // tentativas por id (teto, para um servidor que crasha em loop não reconectar
  // infinitamente).
  const serversRef = useRef(mcpServers)
  serversRef.current = mcpServers
  const reconnectRef = useRef<Map<string, number>>(new Map())
  const MAX_RECONNECTS = 2

  // (Re)conecta quando a lista de servidores muda. Assinatura estável evita
  // reconexão a cada render.
  const sig = (mcpServers || []).map(s => `${s.name}|${s.command}`).join('\n')

  useEffect(() => {
    let cancelled = false
    const servers = mcpServers || []
    // Desconecta servidores conectados numa rodada anterior antes de reconectar
    // (cobre servidores removidos da config; o backend mata same-id ao reconectar).
    const disconnectPrev = () => {
      const ids = [...connectedRef.current]
      connectedRef.current = new Set()
      for (const id of ids) { try { window.electron.mcpDisconnect?.(id) } catch { /* best-effort */ } }
    }
    if (!enabled || servers.length === 0) {
      disconnectPrev()
      setMcpTools([]); setStatus([])
      return
    }
    if (!window.electron?.mcpConnect) return
    disconnectPrev()
    reconnectRef.current.clear() // nova config → zera os contadores de reconexão

    ;(async () => {
      const allDefs: McpToolDef[] = []
      const nextStatus: McpServerStatus[] = []
      const connected = new Set<string>()
      for (const srv of servers) {
        const id = sanitizeServerId(srv.name)
        const { command, args } = parseCommand(srv.command)
        if (!command) {
          nextStatus.push({ id, name: srv.name, connected: false, toolCount: 0, error: 'comando vazio' })
          continue
        }
        try {
          const res: any = await window.electron.mcpConnect({ id, command, args })
          if (res?.error) {
            nextStatus.push({ id, name: srv.name, connected: false, toolCount: 0, error: res.error })
            continue
          }
          const defs = serverToolsToDefs(id, res?.tools || [])
          allDefs.push(...defs)
          connected.add(id)
          nextStatus.push({ id, name: srv.name, connected: true, toolCount: defs.length })
        } catch (e: any) {
          nextStatus.push({ id, name: srv.name, connected: false, toolCount: 0, error: e?.message || 'falha ao conectar' })
        }
      }
      if (cancelled) return
      connectedRef.current = connected
      setMcpTools(allDefs)
      setStatus(nextStatus)
    })()

    return () => {
      cancelled = true
      // Ao desmontar / antes de reconectar: desconecta os servidores desta
      // rodada para não vazar processos filhos.
      const ids = [...connectedRef.current]
      connectedRef.current = new Set()
      for (const id of ids) { try { window.electron.mcpDisconnect?.(id) } catch { /* best-effort */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, enabled])

  // Resiliência (v2.43.0): se um servidor MCP morre no meio da sessão, o backend
  // avisa — podamos as tools desse servidor para o modelo não tentar tools mortas.
  useEffect(() => {
    if (!window.electron?.onMcpServerExit) return
    const off = window.electron.onMcpServerExit(({ id }) => {
      const prefix = `mcp__${id}__`
      connectedRef.current.delete(id)
      setMcpTools(prev => prev.filter(t => !t.function.name.startsWith(prefix)))
      setStatus(prev => prev.map(s => s.id === id ? { ...s, connected: false, toolCount: 0, error: s.error || 'desconectado (processo encerrou)' } : s))
      // Reconexão automática com backoff (v2.122.0): tenta religar o servidor
      // (transiente: crash/OOM/restart) até MAX_RECONNECTS, sem loop infinito.
      const attempts = reconnectRef.current.get(id) || 0
      if (attempts >= MAX_RECONNECTS) return
      reconnectRef.current.set(id, attempts + 1)
      setStatus(prev => prev.map(s => s.id === id ? { ...s, error: `reconectando (${attempts + 1}/${MAX_RECONNECTS})…` } : s))
      setTimeout(async () => {
        const srv = (serversRef.current || []).find(s => sanitizeServerId(s.name) === id)
        if (!srv || !window.electron?.mcpConnect) return
        const { command, args } = parseCommand(srv.command)
        if (!command) return
        try {
          const res: any = await window.electron.mcpConnect({ id, command, args })
          if (res?.error) {
            setStatus(prev => prev.map(s => s.id === id ? { ...s, error: res.error } : s))
            return
          }
          const defs = serverToolsToDefs(id, res?.tools || [])
          connectedRef.current.add(id)
          setMcpTools(prev => [...prev.filter(t => !t.function.name.startsWith(prefix)), ...defs])
          setStatus(prev => prev.map(s => s.id === id ? { ...s, connected: true, toolCount: defs.length, error: undefined } : s))
          reconnectRef.current.delete(id) // sucesso → zera o contador
        } catch (e: any) {
          setStatus(prev => prev.map(s => s.id === id ? { ...s, error: e?.message || 'falha ao reconectar' } : s))
        }
      }, 2000 * (attempts + 1)) // backoff 2s, 4s
    })
    return off
  }, [])

  /** Roteia uma chamada `mcp__servidor__tool` para o servidor certo. */
  const callMcpTool = useCallback(async (fullName: string, args: Record<string, any>): Promise<string> => {
    const parsed = parseMcpToolName(fullName)
    if (!parsed) return `MCP error: nome de tool inválido "${fullName}"`
    if (!connectedRef.current.has(parsed.serverId)) return `MCP error: servidor "${parsed.serverId}" não conectado`
    // Valida os args contra o inputSchema da tool ANTES de mandar ao servidor
    // externo (v2.122.0) — erro acionável p/ o modelo corrigir, em vez de o
    // servidor receber args malformados.
    const def = mcpToolsRef.current.find(t => t.function.name === fullName)
    if (def) {
      const { valid, errors } = validateToolArgs(args, def.function.parameters)
      if (!valid) return `MCP error: argumentos inválidos para ${fullName}: ${errors.join('; ')}. Corrija e chame de novo.`
    }
    try {
      const res: any = await window.electron.mcpCallTool({ connectionId: parsed.serverId, toolName: parsed.toolName, args: args || {} })
      if (res?.error) return `MCP error: ${res.error}`
      return res?.result || '(sem saída)'
    } catch (e: any) {
      return `MCP error: ${e?.message || 'falha na chamada'}`
    }
  }, [])

  return { mcpTools, mcpStatus: status, callMcpTool }
}
