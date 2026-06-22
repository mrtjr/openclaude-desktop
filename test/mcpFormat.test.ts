import { describe, it, expect } from 'vitest'
// @ts-ignore — CJS helper
import { formatMcpContent } from '../electron/mcp-format.js'

describe('formatMcpContent (M4)', () => {
  it('junta blocos de texto', () => {
    expect(formatMcpContent({ content: [{ type: 'text', text: 'olá' }, { type: 'text', text: ' mundo' }] }))
      .toBe('olá\n mundo')
  })
  it('prefixa MCP tool error quando isError', () => {
    expect(formatMcpContent({ isError: true, content: [{ type: 'text', text: 'falhou X' }] }))
      .toBe('MCP tool error: falhou X')
  })
  it('representa image/resource semanticamente em vez de JSON cru', () => {
    expect(formatMcpContent({ content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] }))
      .toBe('[image image/png]')
    expect(formatMcpContent({ content: [{ type: 'resource', resource: { uri: 'file://a.txt', text: 'conteudo' } }] }))
      .toBe('[resource file://a.txt]\nconteudo')
  })
  it('content não-array: usa o cru (com prefixo se isError)', () => {
    expect(formatMcpContent({ foo: 1 })).toBe('{"foo":1}')
    expect(formatMcpContent({ isError: true, foo: 1 })).toContain('MCP tool error:')
  })
  it('vazio/nulo', () => {
    expect(formatMcpContent(null)).toBe('')
    expect(formatMcpContent({ content: [] })).toBe('(sem conteúdo)')
  })
})
