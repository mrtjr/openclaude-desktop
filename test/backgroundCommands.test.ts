import { describe, it, expect } from 'vitest'
import { formatBackgroundStart, formatCommandOutput } from '../src/utils/backgroundCommands'

describe('formatBackgroundStart', () => {
  it('instrui a consultar/matar pelo id', () => {
    const out = formatBackgroundStart({ id: 'bg1', pid: 1234 }, 'npm run dev')
    expect(out).toContain('bg1')
    expect(out).toContain('get_command_output')
    expect(out).toContain('kill_background_command')
    expect(out).toContain('npm run dev')
  })
  it('erro → mensagem acionável', () => {
    expect(formatBackgroundStart({ error: 'pasta inexistente' }, 'x')).toContain('pasta inexistente')
    expect(formatBackgroundStart({} as any, 'x').toLowerCase()).toContain('não consegui iniciar')
  })
})

describe('formatCommandOutput', () => {
  it('não encontrado → mensagem clara', () => {
    expect(formatCommandOutput({ found: false }, 'bg9').toLowerCase()).toContain('nenhum comando')
  })
  it('rodando com saída nova → mostra saída + "ainda rodando"', () => {
    const out = formatCommandOutput({ found: true, running: true, stdout: 'compilando...\nok', elapsedMs: 5000 }, 'bg1')
    expect(out).toContain('compilando...')
    expect(out).toContain('AINDA RODANDO')
    expect(out).toContain('5s')
  })
  it('rodando sem saída → aguarde', () => {
    expect(formatCommandOutput({ found: true, running: true, stdout: '', elapsedMs: 90000 }, 'bg1'))
      .toMatch(/sem saída nova ainda/)
  })
  it('terminado → exit code + tempo formatado', () => {
    const out = formatCommandOutput({ found: true, running: false, exitCode: 0, stdout: 'done', elapsedMs: 125000 }, 'bg2')
    expect(out).toContain('done')
    expect(out).toContain('exit code 0')
    expect(out).toContain('2m05s')
  })
  it('separa stderr e sinaliza interrupção', () => {
    const out = formatCommandOutput({ found: true, running: false, killedByUser: true, stderr: 'aviso', elapsedMs: 1000 }, 'bg3')
    expect(out).toContain('--- stderr ---')
    expect(out).toContain('interrompido')
  })
})
