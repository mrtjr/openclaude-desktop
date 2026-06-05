import { describe, it, expect } from 'vitest'
import { extractArtifacts, artifactSrcDoc } from '../src/utils/artifacts'

describe('extractArtifacts', () => {
  it('finds html and svg fenced blocks', () => {
    const md = 'Veja:\n```html\n<h1>Hi</h1>\n```\ne\n```svg\n<svg></svg>\n```'
    const arts = extractArtifacts(md)
    expect(arts).toHaveLength(2)
    expect(arts[0]).toMatchObject({ lang: 'html', code: '<h1>Hi</h1>' })
    expect(arts[1]).toMatchObject({ lang: 'svg', code: '<svg></svg>' })
  })

  it('ignores non-renderable code blocks and empty input', () => {
    expect(extractArtifacts('```js\nconsole.log(1)\n```')).toEqual([])
    expect(extractArtifacts('no code here')).toEqual([])
    expect(extractArtifacts('')).toEqual([])
  })

  it('skips empty blocks', () => {
    expect(extractArtifacts('```html\n\n```')).toEqual([])
  })

  it('artifactSrcDoc passes html through and centers svg', () => {
    expect(artifactSrcDoc({ lang: 'html', code: '<h1>x</h1>', title: 'HTML' })).toBe('<h1>x</h1>')
    const svg = artifactSrcDoc({ lang: 'svg', code: '<svg/>', title: 'SVG' })
    expect(svg).toContain('<svg/>')
    expect(svg).toContain('display:flex')
  })
})
