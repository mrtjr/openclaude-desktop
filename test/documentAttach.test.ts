import { describe, it, expect } from 'vitest'
import { buildDocumentContext, docPlusText, DOC_CONTEXT_CAP } from '../src/utils/documentAttach'

describe('buildDocumentContext', () => {
  it('inclui nome, páginas e o corpo entre delimitadores', () => {
    const out = buildDocumentContext({ name: 'relatorio.pdf', content: 'linha1\nlinha2', pages: 3 })
    expect(out).toContain('[Documento anexado: relatorio.pdf (3 páginas)]')
    expect(out).toContain('linha1\nlinha2')
  })

  it('singular para 1 página; sem meta sem páginas', () => {
    expect(buildDocumentContext({ name: 'a.docx', content: 'x', pages: 1 })).toContain('(1 página)')
    expect(buildDocumentContext({ name: 'a.txt', content: 'x' })).toContain('[Documento anexado: a.txt]')
  })

  it('trunca documentos gigantes com marcador', () => {
    const out = buildDocumentContext({ name: 'big.pdf', content: 'a'.repeat(DOC_CONTEXT_CAP + 1000) })
    expect(out).toContain('…[documento truncado]')
    // corpo capado: DOC_CONTEXT_CAP a's consecutivos existem; +1 não.
    expect(out.includes('a'.repeat(DOC_CONTEXT_CAP))).toBe(true)
    expect(out.includes('a'.repeat(DOC_CONTEXT_CAP + 1))).toBe(false)
  })
})

describe('docPlusText', () => {
  it('concatena contexto do doc + texto do usuário', () => {
    const out = docPlusText({ name: 'd.txt', content: 'conteúdo' }, 'resuma isso')
    expect(out).toMatch(/\[Documento anexado: d\.txt\][\s\S]*conteúdo[\s\S]*resuma isso/)
  })
  it('só o texto quando não há doc; só o contexto quando não há texto', () => {
    expect(docPlusText(undefined, 'oi')).toBe('oi')
    expect(docPlusText({ name: 'd', content: 'c' }, '')).toContain('[Documento anexado: d]')
  })
})
