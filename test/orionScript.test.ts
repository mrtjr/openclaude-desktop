import { describe, it, expect } from 'vitest'
// @ts-ignore — CJS helper
import { psEscapeDouble, psSingleQuote, sendKeysEscape, buildOrionScript } from '../electron/orion-script.js'

describe('psEscapeDouble', () => {
  it('neutraliza $ (impede $()/$var) e backtick e aspa', () => {
    expect(psEscapeDouble('$(whoami)')).toBe('`$(whoami)')
    expect(psEscapeDouble('$env:PATH')).toBe('`$env:PATH')
    expect(psEscapeDouble('a`b')).toBe('a``b')
    expect(psEscapeDouble('say "hi"')).toBe('say `"hi`"')
  })
})

describe('psSingleQuote', () => {
  it('dobra aspas simples (impede quebra de string single-quoted)', () => {
    expect(psSingleQuote("notepad' -ArgumentList 'x")).toBe("notepad'' -ArgumentList ''x")
  })
})

describe('sendKeysEscape', () => {
  it('escapa metacaracteres do SendKeys para digitar literal', () => {
    expect(sendKeysEscape('a+b^c%d~e')).toBe('a{+}b{^}c{%}d{~}e')
    expect(sendKeysEscape('(x){y}[z]')).toBe('{(}x{)}{{}y{}}{[}z{]}')
  })
  it('mapeia controle: \\n→{ENTER}, \\t→{TAB} (adicionados depois, sem re-escape)', () => {
    expect(sendKeysEscape('a\nb\tc')).toBe('a{ENTER}b{TAB}c')
  })
})

describe('buildOrionScript — blindagem de injeção', () => {
  it('type_text NÃO permite expansão $() — vira literal', () => {
    const s = buildOrionScript('type_text', { text: '$(whoami)' })
    expect(s).toContain('SendWait("')
    // $ escapado com backtick, parênteses viram literais do SendKeys
    expect(s).toContain('`$')
    expect(s).not.toContain('SendWait("$(whoami)")')
  })
  it('key_press preserva a sintaxe SendKeys mas neutraliza $()', () => {
    expect(buildOrionScript('key_press', { key: '{ENTER}' })).toContain('SendWait("{ENTER}")')
    expect(buildOrionScript('key_press', { key: '$(calc)' })).toContain('`$(calc)')
  })
  it('open_app usa aspas simples e escapa injeção de args', () => {
    const s = buildOrionScript('open_app', { app: 'notepad" -WindowStyle Hidden' })
    expect(s.startsWith("Start-Process '")).toBe(true)
    const s2 = buildOrionScript('open_app', { app: "x' ; rm -rf" })
    expect(s2).toContain("'x'' ; rm -rf'")
  })
  it('coordenadas/ms/scroll são numéricos (sem injeção possível)', () => {
    expect(buildOrionScript('move_mouse', { x: '10; calc' as any, y: 5 })).toContain('Point(0, 5)')
    expect(buildOrionScript('wait', { ms: 999999 })).toContain('30000') // clamp
    expect(buildOrionScript('scroll', { delta: 2 })).toContain('240')
  })
  it('tipo desconhecido → null', () => {
    expect(buildOrionScript('hack', {})).toBeNull()
  })
})
