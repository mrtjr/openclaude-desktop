import { useState, useEffect, useRef, useCallback } from 'react'
import type { McpServer } from '../settingsConfig'
import {
  sanitizeServerId, parseCommand, serverToolsToDefs, parseMcpToolName,
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
  const [status, setStatus] = useState<McpServerStatus[]>([])
  // serverId → toolName real (sem namespace) → para rotear a chamada de volta.
  const connectedRef = useRef<Set<string>>(new Set())

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

  /** Roteia uma chamada `mcp__servidor__tool` para o servidor certo. */
  const callMcpTool = useCallback(async (fullName: string, args: Record<string, any>): Promise<string> => {
    const parsed = parseMcpToolName(fullName)
    if (!parsed) return `MCP error: nome de tool inválido "${fullName}"`
    if (!connectedRef.current.has(parsed.serverId)) return `MCP error: servidor "${parsed.serverId}" não conectado`
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
