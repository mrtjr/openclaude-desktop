// ─── Qualidade do scout e do papel do subagente (v2.202.0) ──────────
//
// Três bugs achados por sondagem empírica, não por leitura: a limpeza da query
// destruía URL/pacote, o classificador era ~sempre verdadeiro, e um papel
// levemente errado rendia MENOS que omitir o papel.

import { describe, it, expect } from 'vitest'
import { buildScoutQuery, isSpeculativeSearchWorthy } from '../src/utils/scout'
import { resolveSubagentPrompt, autoInferSubagentRole } from '../src/constants/subagents'

describe('buildScoutQuery — limpeza não pode destruir o termo útil', () => {
  it('de uma URL sobra o HOST, não o esquema', () => {
    const q = buildScoutQuery('erro no https://react.dev/blog/2024 upgrade', '')
    expect(q).toContain('react')
    expect(q).not.toContain('https')
  })

  it('nome de pacote com barra sobrevive inteiro', () => {
    const q = buildScoutQuery('atualizar @types/node e react-dom/client', '')
    for (const termo of ['types', 'node', 'react', 'client']) expect(q).toContain(termo)
  })

  it('uma comparação não pode virar uma palavra só', () => {
    // Regressão dura: "comparar next/image vs img" devolvia exatamente
    // "comparar" — a query perdia TODO o assunto.
    const q = buildScoutQuery('comparar next/image vs img', '')
    expect(q).toContain('image')
    expect(q.split(' ').length).toBeGreaterThan(1)
  })

  it('caminho absoluto de disco continua sendo descartado', () => {
    expect(buildScoutQuery('/home/user/app/src/index.ts docs api', '')).not.toContain('home')
  })
})

describe('isSpeculativeSearchWorthy — precisa FILTRAR, não aprovar tudo', () => {
  it('rejeita tarefa local/mecânica, inclusive com "como" na frase', () => {
    for (const s of [
      'formate esse arquivo',
      'como formatar esse arquivo',       // "como" fazia isto passar
      'renomeie a variavel x para y',
      'adicione um comentario aqui',
      'leia o arquivo e me diga o que tem',
    ]) expect(isSpeculativeSearchWorthy(s), s).toBe(false)
  })

  it('aceita quando há sinal real de pesquisa', () => {
    for (const s of [
      'erro TypeError no build do vite',
      'qual a versao mais nova do react',
      'comparar next/image vs img',
      'ler a documentacao da api do stripe',
    ]) expect(isSpeculativeSearchWorthy(s), s).toBe(true)
  })

  it('texto sem sinal nenhum não dispara só por ter palavras', () => {
    // O escape `keys.size >= 2` aprovava qualquer frase com 2 palavras longas.
    expect(isSpeculativeSearchWorthy('preciso terminar aquela tarefa pendente amanha')).toBe(false)
  })
})

describe('resolveSubagentPrompt — papel errado não pode render menos que papel ausente', () => {
  const tarefa = 'investigue o erro de build'

  it('papel exato vence', () => {
    expect(resolveSubagentPrompt('planner', tarefa)).toBe(resolveSubagentPrompt('planner', ''))
    expect(resolveSubagentPrompt('explorer', tarefa).length).toBeGreaterThan(0)
  })

  it('papel desconhecido cai na inferência em vez de virar prompt vazio', () => {
    for (const a of ['researcher', 'Explorador', 'qualquer-coisa']) {
      expect(resolveSubagentPrompt(a, tarefa).length, a).toBeGreaterThan(0)
    }
  })

  it('"general" (sem método próprio) também cai na inferência', () => {
    expect(resolveSubagentPrompt('general', tarefa).length).toBeGreaterThan(0)
  })

  it('omitir o papel continua funcionando', () => {
    expect(resolveSubagentPrompt(undefined, tarefa).length).toBeGreaterThan(0)
  })

  it('a inferência escolhe pelo texto', () => {
    expect(autoInferSubagentRole('revisar seguranca do login')).toBe('reviewer')
    expect(autoInferSubagentRole('monte um plano de migracao')).toBe('planner')
    expect(autoInferSubagentRole('onde fica a funcao X')).toBe('explorer')
  })
})
