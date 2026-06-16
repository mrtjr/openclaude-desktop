import { describe, it, expect } from 'vitest'
import {
  parseStructuredSummary,
  serializeStructuredSummary,
  mergeStructured,
  mergeSummaryStructured,
  fitToBudget,
  isStructured,
  buildStructuredCompactionPrompt,
  STRUCTURED_SUMMARY_MAX_CHARS,
} from '../src/utils/structuredSummary'

describe('parseStructuredSummary', () => {
  it('faz parse de seções markdown com bullets', () => {
    const s = parseStructuredSummary(
      '## Objetivo\n- corrigir login\n## Decisões\n- usar OAuth\n- token 1h\n## Estado atual\n- em andamento',
    )
    expect(s.objetivo).toEqual(['corrigir login'])
    expect(s.decisoes).toEqual(['usar OAuth', 'token 1h'])
    expect(s.estado).toEqual(['em andamento'])
  })

  it('reconhece cabeçalhos em PT e EN (agnóstico de idioma) e em negrito/dois-pontos', () => {
    const s = parseStructuredSummary('## Goal\n- ship it\n**Key facts:**\n- fact A\nOpen items:\n- next step')
    expect(s.objetivo).toEqual(['ship it'])
    expect(s.fatos).toEqual(['fact A'])
    expect(s.pendencias).toEqual(['next step'])
  })

  it('texto sem seções vai inteiro para notas', () => {
    const s = parseStructuredSummary('apenas um parágrafo plano legado')
    expect(s.notas.join(' ')).toContain('parágrafo plano legado')
    expect(s.objetivo).toEqual([])
  })

  it('texto antes do 1º cabeçalho reconhecido é preservado em notas', () => {
    const s = parseStructuredSummary('preâmbulo importante\n## Objetivo\n- meta')
    expect(s.notas.join(' ')).toContain('preâmbulo importante')
    expect(s.objetivo).toEqual(['meta'])
  })

  it('deduplica itens dentro da mesma seção ignorando caixa/pontuação', () => {
    const s = parseStructuredSummary('## Fatos-chave\n- Usa OAuth.\n- usa oauth\n- Token 1h')
    expect(s.fatos.length).toBe(2)
  })
})

describe('serializeStructuredSummary', () => {
  it('round-trip parse→serialize→parse mantém o conteúdo', () => {
    const md = '## Objetivo\n- meta única\n## Pendências\n- passo 1\n- passo 2'
    const again = parseStructuredSummary(serializeStructuredSummary(parseStructuredSummary(md)))
    expect(again.objetivo).toEqual(['meta única'])
    expect(again.pendencias).toEqual(['passo 1', 'passo 2'])
  })

  it('omite seções vazias e usa rótulos EN quando lang=en', () => {
    const out = serializeStructuredSummary({ objetivo: ['x'], decisoes: [], fatos: [], arquivos: [], estado: [], pendencias: [], notas: [] }, 'en')
    expect(out).toContain('## Goal')
    expect(out).not.toContain('## Decisions')
  })
})

describe('mergeStructured', () => {
  it('duráveis acumulam em ordem cronológica (objetivo antigo preservado no topo)', () => {
    const a = parseStructuredSummary('## Objetivo\n- objetivo original')
    const b = parseStructuredSummary('## Objetivo\n- detalhe novo')
    const m = mergeStructured(a, b)
    expect(m.objetivo[0]).toBe('objetivo original') // antigo primeiro
    expect(m.objetivo).toContain('detalhe novo')
  })

  it('estado volátil prioriza o mais recente (novo primeiro)', () => {
    const a = parseStructuredSummary('## Estado atual\n- estado antigo')
    const b = parseStructuredSummary('## Estado atual\n- estado novo')
    const m = mergeStructured(a, b)
    expect(m.estado[0]).toBe('estado novo')
  })

  it('deduplica na fusão entre prev e next', () => {
    const a = parseStructuredSummary('## Fatos-chave\n- usa OAuth')
    const b = parseStructuredSummary('## Fatos-chave\n- usa oauth\n- novo fato')
    const m = mergeStructured(a, b)
    expect(m.fatos.filter(f => /oauth/i.test(f)).length).toBe(1)
    expect(m.fatos).toContain('novo fato')
  })
})

describe('fitToBudget — preserva o durável, corta o volátil', () => {
  it('corta estado/pendências antes de tocar no objetivo', () => {
    const s = parseStructuredSummary(
      '## Objetivo\n- ENTREGAR_RELATORIO\n## Estado atual\n' +
      Array.from({ length: 50 }, (_, i) => `- linha volátil ${i} ${'y'.repeat(60)}`).join('\n'),
    )
    const out = fitToBudget(s, 'pt', 600)
    expect(out.length).toBeLessThanOrEqual(600)
    expect(out).toContain('ENTREGAR_RELATORIO')
  })

  it('char-trim de notas mantém a CABEÇA (objetivo importado no começo sobrevive)', () => {
    const head = 'OBJETIVO_IMPORTADO no comeco. '
    const s = { objetivo: [], decisoes: [], fatos: [], arquivos: [], estado: [], pendencias: [], notas: [head + 'z'.repeat(5000)] }
    const out = fitToBudget(s, 'pt', 400)
    expect(out.length).toBeLessThanOrEqual(420) // teto + marcador de corte
    expect(out).toContain('OBJETIVO_IMPORTADO')
  })
})

describe('mergeSummaryStructured (orquestrador)', () => {
  it('prev vazio retorna next normalizado e estruturado', () => {
    const out = mergeSummaryStructured('', '## Objetivo\n- meta')
    expect(out).toContain('## Objetivo')
    expect(out).toContain('meta')
  })

  it('o objetivo do prev NUNCA é perdido mesmo com next enorme (regressão do corte-de-rabo)', () => {
    const prev = '## Objetivo\n- manter este objetivo vivo'
    const next = '## Estado atual\n' + Array.from({ length: 80 }, (_, i) => `- ${'w'.repeat(90)} ${i}`).join('\n')
    const out = mergeSummaryStructured(prev, next, 1200)
    expect(out.length).toBeLessThanOrEqual(1200)
    expect(out).toContain('manter este objetivo vivo')
  })

  it('default de teto é o constante exportado', () => {
    expect(STRUCTURED_SUMMARY_MAX_CHARS).toBeGreaterThan(2000)
  })
})

describe('isStructured', () => {
  it('detecta cabeçalhos reconhecidos', () => {
    expect(isStructured('## Objetivo\n- x')).toBe(true)
    expect(isStructured('## Goal\n- x')).toBe(true)
    expect(isStructured('texto plano sem seções')).toBe(false)
    expect(isStructured('')).toBe(false)
  })
})

describe('buildStructuredCompactionPrompt', () => {
  it('pede as seções em PT e injeta instruções', () => {
    const p = buildStructuredCompactionPrompt('pt', 'foque nos preços')
    expect(p).toContain('## Objetivo')
    expect(p).toContain('## Pendências')
    expect(p).toContain('Instruções adicionais do usuário: foque nos preços')
  })
  it('versão EN usa rótulos em inglês', () => {
    const p = buildStructuredCompactionPrompt('en')
    expect(p).toContain('## Goal')
    expect(p).toContain('## Open items')
  })
})
