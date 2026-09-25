// ─── Rewind sobrevive ao restart (v2.208.0) ─────────────────────────
//
// Os backups sempre foram para o disco, mas o ÍNDICE vivia só em RAM. Fechar o
// app tornava todo rewind impossível E vazava os backups: a poda contava o
// array, que reiniciava vazio, então nada antigo era apagado.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const main = readFileSync('electron/main.js', 'utf-8')

describe('o índice de snapshots é persistido', () => {
  it('existe caminho em disco e as duas funções de ciclo', () => {
    expect(main).toContain('SNAPSHOT_INDEX_PATH')
    expect(main).toContain('function saveSnapshotIndex')
    expect(main).toContain('function loadSnapshotIndex')
  })

  it('carrega no boot (senão o índice em disco seria inútil)', () => {
    expect(main).toMatch(/^loadSnapshotIndex\(\)$/m)
  })

  it('usa a escrita atômica — um índice truncado perderia todo o rewind', () => {
    const i = main.indexOf('function saveSnapshotIndex')
    expect(main.slice(i, i + 400)).toContain('atomicWriteJSON')
  })

  it('TODA mutação da pilha persiste: snapshot, undo e restore', () => {
    for (const fn of ['function snapshotFile', "ipcMain.handle('undo-last-write'", "ipcMain.handle('checkpoint-restore'"]) {
      const i = main.indexOf(fn)
      expect(i, fn).toBeGreaterThan(-1)
      expect(main.slice(i, i + 1400), fn).toContain('saveSnapshotIndex()')
    }
  })
})

describe('reconciliação no boot', () => {
  it('descarta entrada cujo backup sumiu (rewind falharia no meio)', () => {
    const i = main.indexOf('function loadSnapshotIndex')
    const bloco = main.slice(i, i + 1600)
    expect(bloco).toContain('fs.existsSync(s.backupPath)')
  })

  it('apaga backup órfão — o vazamento que o cap em memória deixava passar', () => {
    const i = main.indexOf('function loadSnapshotIndex')
    const bloco = main.slice(i, i + 1600)
    expect(bloco).toContain('referenced')
    expect(bloco).toContain('unlinkSync')
  })

  it('o seq NUNCA recua — um checkpoint antigo reverteria a escrita errada', () => {
    const i = main.indexOf('function loadSnapshotIndex')
    expect(main.slice(i, i + 1600)).toContain('Math.max')
  })
})

describe('o rewind deixa de depender do toast de 15s', () => {
  const tipos = readFileSync('src/types/index.ts', 'utf-8')
  const chat = readFileSync('src/hooks/useChat.ts', 'utf-8')
  const bolha = readFileSync('src/components/ChatMessage.tsx', 'utf-8')
  const app = readFileSync('src/App.tsx', 'utf-8')

  it('a mensagem carrega a âncora do turno', () => {
    expect(tipos).toContain('checkpoint?: { seq: number; files: number }')
  })

  it('useChat grava a âncora na mensagem do assistente', () => {
    expect(chat).toContain('checkpoint: { seq, files: count }')
  })

  it('a bolha oferece reverter, e só quando houve arquivo alterado', () => {
    expect(bolha).toContain('onRevertCheckpoint')
    expect(bolha).toContain('msg.checkpoint.files > 0')
  })

  it('o App liga o handler e limpa o selo após reverter', () => {
    expect(app).toContain('onRevertCheckpoint={handleRevertCheckpoint}')
    // Sem limpar, um 2º clique não teria snapshots e diria "revertido 0".
    expect(app).toContain('checkpoint: undefined')
  })

  it('a ação destrutiva passa por confirmação explícita', () => {
    // v2.209.0: o window.confirm virou o RewindDialog — três saídas
    // (cancelar / só arquivos / arquivos + conversa) não cabem num confirm().
    // O que este teste protege é o INVARIANTE: o clique não pode reverter
    // direto; tem de abrir uma confirmação.
    const i = app.indexOf('const handleRevertCheckpoint')
    // Só o corpo do handler: uma janela larga invadiria o applyRewind, que
    // legitimamente chama o restore (depois da escolha no diálogo).
    const corpo = app.slice(i, app.indexOf('const applyRewind', i))
    expect(corpo).toContain('setRewindTarget')
    expect(corpo).not.toContain('checkpointRestore')  // não reverte no clique
    expect(app).toContain('<RewindDialog')
  })
})
