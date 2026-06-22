import { describe, it, expect } from 'vitest'
import { buildEpisodeSummary } from '../src/utils/episodeMemory'

describe('buildEpisodeSummary (v2.117.0)', () => {
  it('resume pedido → resultado de um turno substantivo', () => {
    const s = buildEpisodeSummary('Como configuro o servidor de otserv?', 'Para configurar o otserv você edita o config.lua e ajusta a porta 7171 e o IP.')
    expect(s).toContain('Pediu:')
    expect(s).toContain('Resultado:')
    expect(s).toContain('otserv')
  })
  it('colapsa espaços e trunca com reticências', () => {
    const s = buildEpisodeSummary('a'.repeat(300), 'b'.repeat(400))
    expect(s.length).toBeLessThanOrEqual(280 + 20)
    expect(s).toContain('…')
  })
  it('vazio quando não há pedido', () => {
    expect(buildEpisodeSummary('', 'resposta qualquer aqui longa')).toBe('')
    expect(buildEpisodeSummary('   ', 'resposta qualquer aqui longa')).toBe('')
  })
  it('vazio quando a resposta não é substantiva (curta/erro/intercept)', () => {
    expect(buildEpisodeSummary('faça x', 'ok')).toBe('')
    expect(buildEpisodeSummary('faça x', '[SYSTEM INTERCEPT]: erro de json aqui então')).toBe('')
    expect(buildEpisodeSummary('faça x', '[USER DENIED]: recusado pelo usuário agora')).toBe('')
  })
})
