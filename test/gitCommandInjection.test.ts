// ─── Injeção no git-command (v2.206.0) ──────────────────────────────
//
// O handler anuncia "only allow git subcommands, no pipes/chains" e bloqueava
// `;` `&` `|` crase `$`. Só que o shell dele é o PowerShell, onde a QUEBRA DE
// LINHA separa comandos igual ao `;`. Verificado na mão: "git --version" +
// nova linha + "echo X" passava pelo filtro e executava OS DOIS.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const NL = String.fromCharCode(10)
const CR = String.fromCharCode(13)

// O mesmo predicado do handler, extraído do fonte para o teste não descrever
// uma regra que o código não tem.
const main = readFileSync('electron/main.js', 'utf-8')
const linha = main.split(NL).find(l => l.includes('.test(command)') && l.includes('resolve'))
  ?? main.split(NL).find(l => l.includes('.test(command)'))!
const corpo = linha.match(/\/\[([^\]]*)\]\//)![1]
const FILTRO = new RegExp('[' + corpo + ']')

describe('o filtro do git-command', () => {
  it('deixa passar comando git legítimo', () => {
    for (const c of ['status', 'log --oneline -5', 'diff HEAD~1', 'commit -m "ajuste"'])
      expect(FILTRO.test(c), c).toBe(false)
  })

  it('bloqueia os encadeadores que já bloqueava', () => {
    for (const c of ['status; rm -rf ~', 'status && whoami', 'status | more', 'status $(id)', 'status `id`'])
      expect(FILTRO.test(c), c).toBe(true)
  })

  it('bloqueia QUEBRA DE LINHA — o furo real', () => {
    // No PowerShell isto executava os dois comandos.
    expect(FILTRO.test('--version' + NL + 'echo INJETADO')).toBe(true)
    expect(FILTRO.test('status' + CR + NL + 'Remove-Item -Recurse -Force ~')).toBe(true)
    expect(FILTRO.test('log' + CR + 'whoami')).toBe(true)
  })

  it('o fonte carrega mesmo CR e LF na classe (nao so o teste)', () => {
    const BS = String.fromCharCode(92)
    expect(corpo).toContain(BS + 'r')
    expect(corpo).toContain(BS + 'n')
  })
})
