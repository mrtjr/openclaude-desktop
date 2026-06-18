import { describe, it, expect } from 'vitest'
import {
  combineHookOutput, applyDisplayTransforms,
  parseDisplayTransforms, formatDisplayTransforms,
} from '../src/utils/outputHooks'

describe('combineHookOutput', () => {
  it('append (default) anexa a saída do hook com a tag', () => {
    const out = combineHookOutput('RESULTADO', 'lint ok', '', 'append', 'prettier')
    expect(out).toBe('RESULTADO\n\n[hook PostToolUse: prettier]\nlint ok')
  })
  it('append sem saída marca "(ok, sem saída)"', () => {
    expect(combineHookOutput('R', '', '', 'append', 'x')).toBe('R\n\n[hook PostToolUse: x] (ok, sem saída)')
  })
  it('replace troca o resultado pelo stdout do hook', () => {
    expect(combineHookOutput('SEGREDO=abc', 'SEGREDO=«redigido»', '', 'replace', 'redact')).toBe('SEGREDO=«redigido»')
  })
  it('replace sem stdout mantém o original (anexando stderr se houver)', () => {
    expect(combineHookOutput('R', '', '', 'replace', 'x')).toBe('R')
    expect(combineHookOutput('R', '', 'boom', 'replace', 'x')).toBe('R\n\n[hook PostToolUse: x] stderr\nboom')
  })
})

describe('applyDisplayTransforms', () => {
  it('substitui conforme as regras', () => {
    const out = applyDisplayTransforms('chave sk-ABCDEFGHIJKLMNOPQRSTUV fim', [
      { pattern: 'sk-[A-Za-z0-9]{20,}', replacement: '«redigido»' },
    ])
    expect(out).toBe('chave «redigido» fim')
  })
  it('substituição vazia OCULTA o trecho', () => {
    expect(applyDisplayTransforms('aXXb', [{ pattern: 'XX' }])).toBe('ab')
  })
  it('regex inválida é ignorada (não quebra)', () => {
    expect(applyDisplayTransforms('abc', [{ pattern: '[' }])).toBe('abc')
  })
  it('sem regras devolve o texto intacto', () => {
    expect(applyDisplayTransforms('abc', [])).toBe('abc')
    expect(applyDisplayTransforms('abc', undefined)).toBe('abc')
  })
})

describe('parse/format display transforms', () => {
  it('parseia "padrão ==> substituição" e padrão solo (oculta)', () => {
    expect(parseDisplayTransforms('foo ==> bar\nbaz')).toEqual([
      { pattern: 'foo', replacement: 'bar' },
      { pattern: 'baz' },
    ])
  })
  it('ignora vazias e comentários', () => {
    expect(parseDisplayTransforms('\n# nota\n  ')).toEqual([])
  })
  it('round-trip', () => {
    const text = 'sk-\\w+ ==> «x»\nTOKEN_\\w+'
    expect(formatDisplayTransforms(parseDisplayTransforms(text))).toBe(text)
  })
})
