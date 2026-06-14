import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain CommonJS helper, no types
import { decodeEntities, extractTitle, htmlToText, looksThin } from '../electron/web-fetch-util.js'

describe('decodeEntities', () => {
  it('decodifica named, numéricos decimais e hexadecimais', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b')
    expect(decodeEntities('&lt;tag&gt;')).toBe('<tag>')
    expect(decodeEntities('caf&#233;')).toBe('café')
    expect(decodeEntities('&#x2014;')).toBe('—')
  })
  it('deixa entidades desconhecidas intactas e lida com vazio', () => {
    expect(decodeEntities('&naoexiste;')).toBe('&naoexiste;')
    expect(decodeEntities(null)).toBe('')
  })
})

describe('extractTitle', () => {
  it('pega o <title> e decodifica', () => {
    expect(extractTitle('<html><head><title>Olá &amp; Tchau</title></head>')).toBe('Olá & Tchau')
  })
  it('vazio quando não há title', () => {
    expect(extractTitle('<html><body>x</body></html>')).toBe('')
  })
})

describe('htmlToText', () => {
  it('remove script/style e seu conteúdo', () => {
    const html = '<body><script>var x=1; alert("oi")</script><p>Conteúdo real</p><style>.a{color:red}</style></body>'
    const out = htmlToText(html)
    expect(out).toContain('Conteúdo real')
    expect(out).not.toContain('alert')
    expect(out).not.toContain('color:red')
  })
  it('quebra blocos em novas linhas e colapsa espaços', () => {
    const out = htmlToText('<p>Um</p><p>Dois</p>')
    expect(out).toBe('Um\nDois')
  })
  it('decodifica entidades no corpo', () => {
    expect(htmlToText('<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>')).toBe('1 < 2 && 3 > 2')
  })
  it('lida com html vazio/nulo', () => {
    expect(htmlToText('')).toBe('')
    expect(htmlToText(null)).toBe('')
  })
})

describe('looksThin', () => {
  it('true para texto curto (shell de SPA)', () => {
    expect(looksThin('Carregando...')).toBe(true)
    expect(looksThin('')).toBe(true)
  })
  it('false para conteúdo substancial', () => {
    expect(looksThin('x'.repeat(250))).toBe(false)
  })
})
