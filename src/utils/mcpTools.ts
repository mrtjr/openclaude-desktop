// ─── MCP tools — helpers puros (ligar MCP ao loop do agente) ────────
//
// O backend já conecta e chama servidores MCP (electron/main.js), mas as tools
// dos servidores nunca chegavam ao modelo. Estes helpers (puros, testáveis)
// fazem a ponte: parse do comando configurado, namespacing das tools no padrão
// do Claude (`mcp__<servidor>__<tool>`) e conversão do inputSchema MCP para o
// formato de function-tool que o resto do app usa.

export interface McpToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: any }
}

/** Sanitiza um nome de servidor para virar prefixo de tool (só [a-zA-Z0-9_]). */
export function sanitizeServerId(name: string): string {
  return String(name || '').trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'server'
}

/** Quebra a string de comando ("npx -y pkg /dir") em command + args.
 *  Suporta aspas simples/duplas para argumentos com espaço. */
export function parseCommand(cmd: string): { command: string; args: string[] } {
  const tokens = String(cmd || '').match(/"[^"]*"|'[^']*'|\S+/g) || []
  const clean = tokens.map(t => t.replace(/^["']|["']$/g, ''))
  return { command: clean[0] || '', args: clean.slice(1) }
}

/** Nome namespaced de uma tool MCP, no padrão do Claude. */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${sanitizeServerId(serverId)}__${toolName}`
}

/** True se o nome de tool pertence a um servidor MCP. */
export function isMcpToolName(name: string): boolean {
  return typeof name === 'string' && name.startsWith('mcp__')
}

/** Decompõe `mcp__<servidor>__<tool>` em { serverId, toolName }. O toolName
 *  pode conter '__', então só o primeiro segmento é o servidor. null se inválido. */
export function parseMcpToolName(full: string): { serverId: string; toolName: string } | null {
  if (!isMcpToolName(full)) return null
  const rest = full.slice('mcp__'.length)
  const idx = rest.indexOf('__')
  if (idx < 0) return null
  const serverId = rest.slice(0, idx)
  const toolName = rest.slice(idx + 2)
  if (!serverId || !toolName) return null
  return { serverId, toolName }
}

/** Converte uma tool MCP ({ name, description, inputSchema }) no def de
 *  function-tool que o modelo recebe, com o nome já namespaced. */
export function toToolDef(serverId: string, mcpTool: any): McpToolDef {
  const name = mcpToolName(serverId, mcpTool?.name || 'tool')
  const params = mcpTool?.inputSchema && typeof mcpTool.inputSchema === 'object'
    ? mcpTool.inputSchema
    : { type: 'object', properties: {} }
  const desc = String(mcpTool?.description || `MCP tool ${mcpTool?.name || ''} from ${serverId}`).slice(0, 1024)
  return { type: 'function', function: { name, description: desc, parameters: params } }
}

/** Converte a lista de tools de um servidor em defs prontos para o modelo. */
export function serverToolsToDefs(serverId: string, tools: any[]): McpToolDef[] {
  return (Array.isArray(tools) ? tools : []).map(t => toToolDef(serverId, t))
}
