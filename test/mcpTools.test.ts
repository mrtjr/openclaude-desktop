import { describe, it, expect } from 'vitest'
import {
  sanitizeServerId, parseCommand, mcpToolName, isMcpToolName,
  parseMcpToolName, toToolDef, serverToolsToDefs,
} from '../src/utils/mcpTools'

describe('sanitizeServerId', () => {
  it('troca não-alfanuméricos por _ e apara as bordas', () => {
    expect(sanitizeServerId('file system!')).toBe('file_system')
    expect(sanitizeServerId('@scope/pkg')).toBe('scope_pkg')
    expect(sanitizeServerId('')).toBe('server')
  })
})

describe('parseCommand', () => {
  it('quebra comando + args', () => {
    expect(parseCommand('npx -y @modelcontextprotocol/server-filesystem /home'))
      .toEqual({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/home'] })
  })
  it('respeita aspas em args com espaço', () => {
    expect(parseCommand('mycmd --path "C:\\Program Files\\x"'))
      .toEqual({ command: 'mycmd', args: ['--path', 'C:\\Program Files\\x'] })
  })
  it('vazio → command vazio', () => {
    expect(parseCommand('')).toEqual({ command: '', args: [] })
  })
})

describe('mcpToolName / parseMcpToolName', () => {
  it('namespacing ida e volta', () => {
    const full = mcpToolName('fs', 'read_file')
    expect(full).toBe('mcp__fs__read_file')
    expect(parseMcpToolName(full)).toEqual({ serverId: 'fs', toolName: 'read_file' })
  })
  it('toolName pode conter __ (só o 1º segmento é o servidor)', () => {
    expect(parseMcpToolName('mcp__github__get__issue')).toEqual({ serverId: 'github', toolName: 'get__issue' })
  })
  it('isMcpToolName e nomes inválidos', () => {
    expect(isMcpToolName('mcp__fs__read')).toBe(true)
    expect(isMcpToolName('read_file')).toBe(false)
    expect(parseMcpToolName('read_file')).toBeNull()
    expect(parseMcpToolName('mcp__onlyserver')).toBeNull()
  })
})

describe('toToolDef / serverToolsToDefs', () => {
  it('converte uma tool MCP preservando inputSchema', () => {
    const def = toToolDef('fs', { name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } })
    expect(def.type).toBe('function')
    expect(def.function.name).toBe('mcp__fs__read_file')
    expect(def.function.description).toBe('Read')
    expect(def.function.parameters.required).toEqual(['path'])
  })
  it('usa parameters default quando não há inputSchema', () => {
    const def = toToolDef('fs', { name: 'noop' })
    expect(def.function.parameters).toEqual({ type: 'object', properties: {} })
  })
  it('mapeia a lista inteira', () => {
    const defs = serverToolsToDefs('db', [{ name: 'query' }, { name: 'exec' }])
    expect(defs.map(d => d.function.name)).toEqual(['mcp__db__query', 'mcp__db__exec'])
  })
})
