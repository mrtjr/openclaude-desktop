import { describe, it, expect } from 'vitest'
import { detectFreshness, buildDateLine, FRESHNESS_RULE, buildFreshnessNudge } from '../src/utils/freshness'

describe('detectFreshness', () => {
  it('marca perguntas sensíveis a tempo (sinais fortes)', () => {
    expect(detectFreshness('qual a última versão do React?', 2026).timeSensitive).toBe(true)
    expect(detectFreshness('o que há de novidade no Node?', 2026).timeSensitive).toBe(true)
    expect(detectFreshness('esse pacote está deprecated?', 2026).timeSensitive).toBe(true)
    expect(detectFreshness('what is the latest version of Vite?', 2026).timeSensitive).toBe(true)
    expect(detectFreshness('preço atual do bitcoin agora', 2026).timeSensitive).toBe(true)
  })

  it('marca menção a ano >= ano corrente, ignora anos passados', () => {
    expect(detectFreshness('melhores práticas em 2026', 2026).timeSensitive).toBe(true)
    expect(detectFreshness('novidades de 2027', 2026).timeSensitive).toBe(true)
    expect(detectFreshness('o que mudou no padrão de 2019?', 2026).timeSensitive).toBe(false)
  })

  it('funciona sem acentos (normaliza a entrada)', () => {
    expect(detectFreshness('ultima versao do python', 2026).timeSensitive).toBe(true)
    expect(detectFreshness('cotacao do dolar', 2026).timeSensitive).toBe(true)
  })

  it('NÃO dispara em perguntas atemporais', () => {
    expect(detectFreshness('explique como funciona um loop for', 2026).timeSensitive).toBe(false)
    expect(detectFreshness('olá, tudo bem?', 2026).timeSensitive).toBe(false)
    expect(detectFreshness('liste os arquivos em D:\\', 2026).timeSensitive).toBe(false)
    expect(detectFreshness('me explique agora esse trecho de código', 2026).timeSensitive).toBe(false)
  })

  it('um sinal fraco isolado não basta; dois bastam', () => {
    expect(detectFreshness('qual a versão?', 2026).timeSensitive).toBe(false)
    expect(detectFreshness('qual a versão atual da api?', 2026).timeSensitive).toBe(true)
  })

  it('retorna os rótulos dos sinais', () => {
    const r = detectFreshness('última versão e changelog', 2026)
    expect(r.signals.length).toBeGreaterThan(0)
  })
})

describe('buildDateLine', () => {
  it('formata PT e EN deterministicamente', () => {
    const d = new Date(2026, 5, 16) // mês 5 = junho
    expect(buildDateLine('pt', d)).toBe('Data de hoje: 16 de junho de 2026.')
    expect(buildDateLine('en', d)).toBe("Today's date: June 16, 2026.")
  })
})

describe('FRESHNESS_RULE', () => {
  it('tem PT e EN e menciona verificar com web_search', () => {
    expect(FRESHNESS_RULE.pt).toContain('web_search')
    expect(FRESHNESS_RULE.en).toContain('web_search')
    expect(FRESHNESS_RULE.pt.toLowerCase()).toContain('desatualizado')
  })
})

describe('buildFreshnessNudge', () => {
  it('inclui os sinais e instrui a verificar', () => {
    const n = buildFreshnessNudge('pt', ['última versão', 'changelog'])
    expect(n).toContain('última versão')
    expect(n).toMatch(/web_search|fetch_url/)
    expect(buildFreshnessNudge('en', ['latest'])).toContain('latest')
  })
})
