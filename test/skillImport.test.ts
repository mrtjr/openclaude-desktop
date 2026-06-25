import { describe, it, expect } from 'vitest'
import { parseSkillMarkdown, splitFrontmatter, sanitizeSkillName, toSkillMarkdown, lintSkill, buildImportedSkills, parseRepoSpec, parseSkillIndex } from '../src/utils/skillImport'

describe('parseRepoSpec', () => {
  it('aceita owner/repo, URL, .git e /tree/branch', () => {
    expect(parseRepoSpec('anthropics/skills')).toEqual({ owner: 'anthropics', repo: 'skills' })
    expect(parseRepoSpec('https://github.com/anthropics/skills')).toEqual({ owner: 'anthropics', repo: 'skills' })
    expect(parseRepoSpec('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' })
    expect(parseRepoSpec('https://github.com/o/r/tree/dev/sub')).toEqual({ owner: 'o', repo: 'r', branch: 'dev' })
    expect(parseRepoSpec('git@github.com:o/r.git')).toEqual({ owner: 'o', repo: 'r' })
  })
  it('null para entradas inválidas', () => {
    expect(parseRepoSpec('')).toBeNull()
    expect(parseRepoSpec('só-isso')).toBeNull()
  })
})

describe('parseSkillIndex (seguidor de índice awesome-*)', () => {
  it('extrai owner/repo de links, deduplica e preserva a 1ª ocorrência', () => {
    const md = [
      '# Awesome Agent Skills',
      '- [PDF tools](https://github.com/alice/pdf-skills) — lida com PDFs',
      '- [Code review](https://github.com/bob/review-skills)',
      '- duplicada: https://github.com/alice/pdf-skills again',
    ].join('\n')
    expect(parseSkillIndex(md)).toEqual([
      { owner: 'alice', repo: 'pdf-skills' },
      { owner: 'bob', repo: 'review-skills' },
    ])
  })

  it('ignora páginas do site, subdomínios (gist/raw) e exclui o próprio índice', () => {
    const md = [
      'https://github.com/sponsors/someone',          // página do site
      'https://github.com/topics/agent-skills',        // página do site
      'https://gist.github.com/x/abcdef123',           // subdomínio → ignora
      'https://raw.githubusercontent.com/x/y/main/a',  // outro host → ignora
      'https://github.com/voltagent/awesome-agent-skills', // o próprio índice
      'https://github.com/carol/my-skills',            // único válido
    ].join('\n')
    expect(parseSkillIndex(md, { owner: 'voltagent', repo: 'awesome-agent-skills' }))
      .toEqual([{ owner: 'carol', repo: 'my-skills' }])
  })

  it('tolera .git, sub-paths (/tree, /blob), hash e pontuação final', () => {
    const md = [
      'a https://github.com/dave/skills.git.',
      'b https://github.com/eve/cool-skills/tree/main',
      'c (https://github.com/frank/x-skills#install)',
    ].join('\n')
    expect(parseSkillIndex(md)).toEqual([
      { owner: 'dave', repo: 'skills' },
      { owner: 'eve', repo: 'cool-skills' },
      { owner: 'frank', repo: 'x-skills' },
    ])
  })

  it('markdown vazio/sem links → []', () => {
    expect(parseSkillIndex('')).toEqual([])
    expect(parseSkillIndex('sem links aqui')).toEqual([])
  })
})

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

describe('buildImportedSkills (bulk)', () => {
  const mk = (name: string, body = 'corpo') => ({ content: `---\nname: ${name}\ndescription: desc de ${name}\n---\n${body}` })
  it('importa válidas, deduplica e conta inválidas', () => {
    const r = buildImportedSkills([
      mk('alpha'),
      mk('beta'),
      mk('alpha'),                       // duplicata entre si
      { content: 'sem frontmatter nem nada' }, // inválida
    ], ['beta'])                          // beta já existe
    expect(r.imported).toBe(1)            // só alpha
    expect(r.skills.map(s => s.name)).toEqual(['alpha'])
    expect(r.duplicates).toBe(2)          // beta (existente) + 2ª alpha
    expect(r.invalid).toBe(1)
  })
  it('lista vazia → zero', () => {
    expect(buildImportedSkills([])).toEqual({ skills: [], imported: 0, invalid: 0, duplicates: 0 })
  })
})

describe('lintSkill', () => {
  it('skill bem-formada → sem avisos', () => {
    expect(lintSkill({
      name: 'code-review', description: 'Use ao revisar pull requests em busca de bugs', instructions: 'Passos…', triggers: ['review'],
    })).toEqual([])
  })

  it('aponta nome fora do padrão e reservado', () => {
    expect(lintSkill({ name: 'My Skill', description: 'descrição clara o suficiente aqui', instructions: 'x' }).join(' ')).toMatch(/fora do padrão/i)
    expect(lintSkill({ name: 'claude', description: 'descrição clara o suficiente aqui', instructions: 'x' }).join(' ')).toMatch(/reservado/i)
  })

  it('aponta descrição vazia/curta e corpo gigante', () => {
    expect(lintSkill({ name: 'x', description: '', instructions: 'x' }).join(' ')).toMatch(/sem descrição/i)
    expect(lintSkill({ name: 'x', description: 'curta', instructions: 'x' }).join(' ')).toMatch(/muito curta/i)
    const big = lintSkill({ name: 'ok-name', description: 'descrição suficientemente longa para o lint', instructions: 'l\n'.repeat(600) })
    expect(big.join(' ')).toMatch(/> 500|progressive disclosure/i)
  })

  it('aponta descoberta difícil (sem gatilho + descrição fraca)', () => {
    expect(lintSkill({ name: 'x', description: 'faz coisas', instructions: 'corpo' }).join(' ')).toMatch(/descobrir/i)
  })
})
