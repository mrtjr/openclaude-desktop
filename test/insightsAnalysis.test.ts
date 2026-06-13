import { describe, it, expect } from 'vitest'
import { buildAnalysisMessages, flattenEventsForAnalysis, ANALYSIS_EVENT_SAMPLE } from '../src/services/insightsAnalysis'
import { summarizeInsights, type InsightEvent } from '../src/services/devInsights'

const now = 1_700_000_000_000
const ev = (minAgo: number, c: InsightEvent['c'], a: string, m?: InsightEvent['m']): InsightEvent =>
  ({ t: now - minAgo * 60_000, c, a, m })

describe('flattenEventsForAnalysis', () => {
  it('achata em linhas compactas, mais novos primeiro, com meta k=v', () => {
    const out = flattenEventsForAnalysis([
      ev(30, 'chat', 'turn', { provider: 'modal', model: 'glm', v: '2.14.0' }),
      ev(10, 'error', 'timeout', { turn: 'ab12' }),
    ])
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('[error/timeout]')
    expect(lines[0]).toContain('turn=ab12')
    expect(lines[1]).toContain('[chat/turn]')
    expect(lines[1]).toContain('provider=modal · model=glm · v=2.14.0')
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO timestamp
  })

  it('respeita o cap da amostra', () => {
    const many = Array.from({ length: 300 }, (_, i) => ev(i, 'tool', 'use', { name: 'x' }))
    expect(flattenEventsForAnalysis(many).split('\n')).toHaveLength(ANALYSIS_EVENT_SAMPLE)
  })
})

describe('buildAnalysisMessages', () => {
  const events = [
    ev(30, 'chat', 'turn', { provider: 'modal', model: 'glm', turn: 'a' }),
    ev(29, 'chat', 'complete', { ms: 100, turn: 'a', outcome: 'ok' }),
    ev(10, 'error', 'timeout', {}),
  ]
  const digest = summarizeInsights(events, 30, now)

  it('system define as seções obrigatórias e as regras anti-alucinação', () => {
    const [system] = buildAnalysisMessages(digest, events, 'pt')
    expect(system.role).toBe('system')
    for (const section of ['## Diagnóstico', '## Top 3 prioridades', '## Hipóteses', '## Próximo ciclo sugerido', '## Monitorar']) {
      expect(system.content).toContain(section)
    }
    expect(system.content).toMatch(/não invente/i)
  })

  it('user carrega o digest formatado e a amostra de eventos', () => {
    const [, user] = buildAnalysisMessages(digest, events, 'pt')
    expect(user.content).toContain('=== DIGEST AGREGADO ===')
    expect(user.content).toContain('# Dev Insights')
    expect(user.content).toContain('=== AMOSTRA DE EVENTOS CRUS')
    expect(user.content).toContain('[error/timeout]')
  })

  it('versão em inglês quando language=en', () => {
    const [system, user] = buildAnalysisMessages(digest, events, 'en')
    expect(system.content).toContain('## Diagnosis')
    expect(user.content).toContain('=== AGGREGATED DIGEST ===')
  })
})
