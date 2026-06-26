import { describe, it, expect } from 'vitest'
import { salvageTruncatedWrite } from '../src/utils/writeRecovery'

describe('salvageTruncatedWrite (v2.161.0 — recupera write_file cortado)', () => {
  it('recupera path + content parcial de um JSON truncado no meio do content', () => {
    // O modelo emitiu write_file e foi cortado no meio do conteúdo (sem aspa final).
    const raw = '{"path":"skills/big.md","content":"# Skill\\nLinha 1\\nLinha 2 que foi cor'
    const r = salvageTruncatedWrite(raw)
    expect(r?.path).toBe('skills/big.md')
    expect(r?.content).toBe('# Skill\nLinha 1\nLinha 2 que foi cor')
    expect(r?.appendHint).toBe(false)
  })

  it('desescapa \\n \\t \\" e ignora barra solta no fim (corte no meio do escape)', () => {
    const raw = '{"path":"a.txt","content":"linha\\tcom\\ttabs e \\"aspas\\"\\nfim\\'
    const r = salvageTruncatedWrite(raw)
    expect(r?.content).toBe('linha\tcom\ttabs e "aspas"\nfim')
  })

  it('content COMPLETO mas truncou depois → corta na aspa de fechamento', () => {
    const raw = '{"path":"x.md","content":"conteudo inteiro","appe'
    const r = salvageTruncatedWrite(raw)
    expect(r?.content).toBe('conteudo inteiro')
  })

  it('detecta appendHint quando append:true veio antes do corte', () => {
    const raw = '{"path":"x.md","append":true,"content":"parte 2 ainda escreven'
    const r = salvageTruncatedWrite(raw)
    expect(r?.appendHint).toBe(true)
    expect(r?.content).toBe('parte 2 ainda escreven')
  })

  it('sem path (corte antes do caminho) → null', () => {
    expect(salvageTruncatedWrite('{"content":"texto sem path ainda')).toBeNull()
    expect(salvageTruncatedWrite('{')).toBeNull()
    expect(salvageTruncatedWrite('')).toBeNull()
  })

  it('path presente mas content ainda não começou → content vazio (cria o arquivo)', () => {
    const r = salvageTruncatedWrite('{"path":"novo.md","conte')
    expect(r?.path).toBe('novo.md')
    expect(r?.content).toBe('')
  })
})
