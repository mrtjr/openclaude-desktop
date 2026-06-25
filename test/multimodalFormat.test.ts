import { describe, it, expect } from 'vitest'
import { parseDataUrl, toAnthropicContent, toGeminiParts } from '../electron/multimodal.js'
import { imageContentBlocks, imageDataUrl } from '../src/utils/multimodal'

const IMG = { base64: 'AAAA', mimeType: 'image/png', name: 'x.png' }

describe('imageContentBlocks / imageDataUrl (renderer)', () => {
  it('monta o array OpenAI com imagem + texto', () => {
    expect(imageDataUrl(IMG)).toBe('data:image/png;base64,AAAA')
    expect(imageContentBlocks(IMG, 'o que é isso?')).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'o que é isso?' },
    ])
  })
  it('sem texto → só a imagem', () => {
    expect(imageContentBlocks(IMG, '   ')).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })
})

describe('parseDataUrl', () => {
  it('extrai mime + base64', () => {
    expect(parseDataUrl('data:image/jpeg;base64,Zm9v')).toEqual({ mime: 'image/jpeg', b64: 'Zm9v' })
    expect(parseDataUrl('http://x.com/a.png')).toBeNull()
  })
})

describe('toAnthropicContent', () => {
  it('string passa intacta', () => {
    expect(toAnthropicContent('oi')).toBe('oi')
  })
  it('array → blocos image(base64)/text', () => {
    const out = toAnthropicContent([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'descreva' },
    ])
    expect(out).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'descreva' },
    ])
  })
})

describe('toGeminiParts', () => {
  it('string → [{text}]', () => {
    expect(toGeminiParts('oi')).toEqual([{ text: 'oi' }])
  })
  it('array → parts inline_data/text', () => {
    const out = toGeminiParts([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'descreva' },
    ])
    expect(out).toEqual([
      { inline_data: { mime_type: 'image/png', data: 'AAAA' } },
      { text: 'descreva' },
    ])
  })
})
