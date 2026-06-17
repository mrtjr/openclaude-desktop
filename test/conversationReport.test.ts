import { describe, it, expect } from 'vitest'
import {
  reportHeader, buildTurnEntry, appendTurn, renderReportForInjection,
  REPORT_STORE_MAX, type ReportAction,
} from '../src/utils/conversationReport'

const actions: ReportAction[] = [
  { tool: 'execute_command', detail: 'npm test', ok: true },
  { tool: 'web_search', detail: 'preço x', ok: false },
]

describe('buildTurnEntry', () => {
  it('monta pedido + ações (✓/✕) + entrega', () => {
    const e = buildTurnEntry({ n: 1, dateLabel: '2026-06-17 19:40', userMessage: 'rode os testes', actions, finalAnswer: 'Testes passaram.' })
    expect(e).toContain('## Turno 1 — 2026-06-17 19:40')
    expect(e).toContain('**Pedido:** rode os testes')
    expect(e).toContain('✓ execute_command: npm test')
    expect(e).toContain('✕ web_search: preço x')
    expect(e).toContain('**Entregue:** Testes passaram.')
  })
  it('omite seções vazias e colapsa espaços', () => {
    const e = buildTurnEntry({ n: 2, dateLabel: 'd', userMessage: '  oi\n\n ', actions: [], finalAnswer: '' })
    expect(e).toContain('**Pedido:** oi')
    expect(e).not.toContain('**Ações:**')
    expect(e).not.toContain('**Entregue:**')
  })
})

describe('appendTurn', () => {
  it('inicia com cabeçalho quando vazio e acrescenta o bloco', () => {
    const md = appendTurn('', 'Backtest', '## Turno 1 — d\n**Pedido:** x')
    expect(md).toContain('# Relatório da conversa: Backtest')
    expect(md).toContain('## Turno 1')
  })
  it('preserva cabeçalho e turnos ao acrescentar', () => {
    let md = appendTurn('', 'C', '## Turno 1 — d\nA')
    md = appendTurn(md, 'C', '## Turno 2 — d\nB')
    expect(md).toContain('## Turno 1')
    expect(md).toContain('## Turno 2')
    expect((md.match(/# Relatório da conversa/g) || []).length).toBe(1) // só 1 cabeçalho
  })
  it('dropa turnos ANTIGOS preservando o cabeçalho ao passar do teto', () => {
    let md = reportHeader('C')
    const big = '## Turno X — d\n' + 'y'.repeat(2000)
    for (let i = 0; i < 80; i++) md = appendTurn(md, 'C', big.replace('X', String(i)), 20000)
    expect(md.length).toBeLessThanOrEqual(20000 + 2200)
    expect(md).toContain('# Relatório da conversa: C')
    expect(md).toContain('turnos antigos omitidos')
    // o último turno sobrevive
    expect(md).toContain('## Turno 79')
  })
})

describe('renderReportForInjection', () => {
  it('vazio → string vazia', () => {
    expect(renderReportForInjection('', 'pt')).toBe('')
    expect(renderReportForInjection('   ', 'en')).toBe('')
  })
  it('curto → injeta inteiro com instrução de não refazer', () => {
    const md = appendTurn('', 'C', '## Turno 1 — d\n**Pedido:** x')
    const out = renderReportForInjection(md, 'pt')
    expect(out).toContain('RELATÓRIO DA CONVERSA')
    expect(out.toLowerCase()).toContain('não refaça')
    expect(out).toContain('## Turno 1')
  })
  it('grande → mantém cabeçalho + turnos recentes e marca omissão', () => {
    let md = reportHeader('C')
    for (let i = 1; i <= 30; i++) md = appendTurn(md, 'C', `## Turno ${i} — d\n` + 'z'.repeat(400))
    const out = renderReportForInjection(md, 'pt', 3000)
    expect(out.length).toBeLessThan(3600)
    expect(out).toContain('# Relatório da conversa: C')
    expect(out).toContain('## Turno 30') // recente preservado
    expect(out).toContain('omitido')
  })
})
