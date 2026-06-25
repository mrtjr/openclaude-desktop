import { describe, it, expect } from 'vitest'
import { parseSkillMarkdown, splitFrontmatter, sanitizeSkillName, toSkillMarkdown } from '../src/utils/skillImport'

describe('sanitizeSkillName', () => {
  it('aplica as regras do padrão (minúsculas/números/hífen, ≤64)', () => {
    expect(sanitizeSkillName('PDF Processing!')).toBe('pdf-processing')
    expect(sanitizeSkillName('  Code__Review  ')).toBe('code-review')
    expect(sanitizeSkillName('a'.repeat(80)).length).toBe(64)
  })
})

describe('splitFrontmatter', () => {
  it('separa meta (scalar, inline-array, block-list) do corpo', () => {
    const md = [
      '---',
      'name: pdf-tools',
      'description: Lida com PDFs',
      'allowed-tools: [read, bash]',
      'disallowed-tools:',
      '  - browser_navigate',
      '  - execute_command',
      '---',
      'Corpo da skill.',
      'Linha 2.',
    ].join('\n')
    const { meta, body } = splitFrontmatter(md)
    expect(meta.name).toBe('pdf-tools')
    expect(meta.description).toBe('Lida com PDFs')
    expect(meta['allowed-tools']).toEqual(['read', 'bash'])
    expect(meta['disallowed-tools']).toEqual(['browser_navigate', 'execute_command'])
    expect(body).toBe('Corpo da skill.\nLinha 2.')
  })

  it('sem frontmatter → corpo inteiro', () => {
    expect(splitFrontmatter('só corpo').body).toBe('só corpo')
  })
})

describe('parseSkillMarkdown', () => {
  it('importa uma skill completa', () => {
    const md = '---\nname: code-review\ndescription: Revisa código\ntriggers: [revisar, review]\n---\nFaça X, Y, Z.'
    const r = parseSkillMarkdown(md)
    expect(r.errors).toEqual([])
    expect(r.skill).toEqual({
      name: 'code-review',
      description: 'Revisa código',
      instructions: 'Faça X, Y, Z.',
      triggers: ['revisar', 'review'],
    })
  })

  it('saneia o nome e avisa', () => {
    const r = parseSkillMarkdown('---\nname: My Skill\ndescription: d\n---\ncorpo')
    expect(r.skill?.name).toBe('my-skill')
    expect(r.warnings.join(' ')).toMatch(/ajustado/i)
  })

  it('falha sem name, sem description ou sem corpo', () => {
    expect(parseSkillMarkdown('---\ndescription: d\n---\ncorpo').errors.join(' ')).toMatch(/name/i)
    expect(parseSkillMarkdown('---\nname: x\n---\ncorpo').errors.join(' ')).toMatch(/description/i)
    expect(parseSkillMarkdown('---\nname: x\ndescription: d\n---\n').errors.join(' ')).toMatch(/corpo/i)
  })

  it('rejeita nomes reservados', () => {
    expect(parseSkillMarkdown('---\nname: claude\ndescription: d\n---\ncorpo').errors.join(' ')).toMatch(/reservado/i)
  })

  it('trunca descrição > 1024 com aviso', () => {
    const r = parseSkillMarkdown(`---\nname: x\ndescription: ${'d'.repeat(1100)}\n---\ncorpo`)
    expect(r.skill?.description.length).toBe(1024)
    expect(r.warnings.join(' ')).toMatch(/truncada/i)
  })
})

describe('toSkillMarkdown (export) — round-trip', () => {
  it('serializa frontmatter + corpo e o parse recupera a skill', () => {
    const md = toSkillMarkdown({
      name: 'code-review', description: 'Revisa código',
      instructions: 'Faça X.', allowedTools: ['read', 'bash'], triggers: ['revisar'],
    })
    expect(md).toMatch(/^---\nname: code-review\ndescription: Revisa código/)
    expect(md).toContain('allowed-tools: [read, bash]')
    const r = parseSkillMarkdown(md)
    expect(r.errors).toEqual([])
    expect(r.skill).toEqual({
      name: 'code-review', description: 'Revisa código', instructions: 'Faça X.',
      allowedTools: ['read', 'bash'], triggers: ['revisar'],
    })
  })

  it('anexa exemplos ao corpo', () => {
    const md = toSkillMarkdown({ name: 'x', description: 'd', instructions: 'corpo', examples: 'ex1' })
    expect(md).toContain('## Exemplos')
    expect(md).toContain('ex1')
  })
})
