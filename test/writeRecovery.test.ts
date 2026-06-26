import { describe, it, expect } from 'vitest'
import { salvageTruncatedWrite, salvageTruncatedSkill, extractJsonStringField } from '../src/utils/writeRecovery'

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

describe('extractJsonStringField', () => {
  it('distingue valor completo de truncado', () => {
    expect(extractJsonStringField('{"a":"oi","b":1', 'a')).toEqual({ value: 'oi', complete: true })
    expect(extractJsonStringField('{"a":"oi sem fim', 'a')).toEqual({ value: 'oi sem fim', complete: false })
    expect(extractJsonStringField('{"a":"x"}', 'b')).toBeNull()
  })
})

describe('salvageTruncatedSkill (v2.162.0 — recupera save_skill cortado)', () => {
  it('recupera name + description + instructions parciais', () => {
    const raw = '{"name":"minha-skill","description":"faz X","instructions":"# Passos\\n1. a\\n2. b ainda escreven'
    const r = salvageTruncatedSkill(raw)
    expect(r?.name).toBe('minha-skill')
    expect(r?.description).toBe('faz X')
    expect(r?.instructions).toBe('# Passos\n1. a\n2. b ainda escreven')
    expect(r?.appendHint).toBe(false)
  })

  it('detecta append:true e instructions parciais (description ausente)', () => {
    const raw = '{"name":"s","append":true,"instructions":"mais conteu'
    const r = salvageTruncatedSkill(raw)
    expect(r?.name).toBe('s')
    expect(r?.appendHint).toBe(true)
    expect(r?.description).toBeUndefined()
    expect(r?.instructions).toBe('mais conteu')
  })

  it('nome incompleto (corte no nome) → null', () => {
    expect(salvageTruncatedSkill('{"name":"minha-ski')).toBeNull()
    expect(salvageTruncatedSkill('{"description":"sem nome"')).toBeNull()
  })

  it('só name (instructions ainda não vieram) → instructions vazio', () => {
    const r = salvageTruncatedSkill('{"name":"nova","descri')
    expect(r?.name).toBe('nova')
    expect(r?.instructions).toBe('')
  })
})
