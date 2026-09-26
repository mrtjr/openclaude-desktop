// ─── Fronteira do subagente implementador (v2.211.0) ────────────────
//
// O pesquisador e read-only; o implementador PRECISA escrever. A fronteira
// nao some, muda de lugar: ele so pode tocar o que esta dentro do worktree
// dele. Este teste e o que garante que ela vale.

import { describe, it, expect } from 'vitest'
import {
  isInsideWorktree, planImplementer, diffCommands, summarizeDiff,
  formatDiffSummary, applyDiffCommand, implementerSystemPrompt,
  IMPLEMENTER_TOOL_NAMES, IMPLEMENTER_FORBIDDEN,
} from '../src/utils/implementerWorker'

const WT = 'D:/proj/.openclaude-worktrees/fix-login-1'

describe('contencao: o worker so escreve dentro da pasta dele', () => {
  it('aceita arquivo dentro do worktree', () => {
    expect(isInsideWorktree(WT + '/src/a.ts', WT)).toBe(true)
    expect(isInsideWorktree(WT, WT)).toBe(true)
  })

  it('RECUSA a arvore principal — o ponto inteiro da feature', () => {
    expect(isInsideWorktree('D:/proj/src/a.ts', WT)).toBe(false)
    expect(isInsideWorktree('D:/proj/package.json', WT)).toBe(false)
  })

  it('e segment-aware: o worktree do vizinho nao vale', () => {
    // 'fix-login-10' comeca com 'fix-login-1' — startsWith cru deixaria passar.
    expect(isInsideWorktree('D:/proj/.openclaude-worktrees/fix-login-10/x.ts', WT)).toBe(false)
  })

  it('recusa travessia com ..', () => {
    expect(isInsideWorktree(WT + '/../../segredo.env', WT)).toBe(false)
    expect(isInsideWorktree(WT + '/src/../../../x', WT)).toBe(false)
  })

  it('trata separador do Windows e do POSIX como iguais', () => {
    expect(isInsideWorktree('D:\\proj\\.openclaude-worktrees\\fix-login-1\\a.ts', WT)).toBe(true)
  })

  it('na duvida, recusa', () => {
    for (const [p, w] of [['', WT], ['   ', WT], [WT, ''], [WT, '   ']])
      expect(isInsideWorktree(p as any, w as any)).toBe(false)
    expect(isInsideWorktree(null as any, WT)).toBe(false)
    expect(isInsideWorktree(WT, null as any)).toBe(false)
  })
})

describe('allowlist do implementador', () => {
  it('tem escrita e execucao — sem isso ele nao implementa nem verifica', () => {
    for (const t of ['write_file', 'edit_file', 'execute_command'])
      expect(IMPLEMENTER_TOOL_NAMES.has(t), t).toBe(true)
  })

  it('mantem as de leitura para ele entender o codigo antes de mexer', () => {
    for (const t of ['read_file', 'search_files', 'glob_files', 'project_tree'])
      expect(IMPLEMENTER_TOOL_NAMES.has(t), t).toBe(true)
  })

  it('NUNCA inclui o que escapa do worktree ou mexe em estado global', () => {
    for (const t of IMPLEMENTER_FORBIDDEN)
      expect(IMPLEMENTER_TOOL_NAMES.has(t), t).toBe(false)
  })
})

describe('coleta do diff', () => {
  it('faz `add -A` ANTES do diff — sem isso arquivo NOVO some do relatorio', () => {
    const c = diffCommands(WT)
    expect(c.stage).toContain('add -A')
    expect(c.diff).toContain('--cached')
    expect(c.stage).toContain(WT)
  })

  it('resume arquivos e linhas do diff unificado', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' contexto',
      '+adicionada',
      '-removida',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- /dev/null',
      '+++ b/src/b.ts',
      '+novo arquivo',
    ].join('\n')
    const s = summarizeDiff(diff)
    expect(s.files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(s.insertions).toBe(2)
    expect(s.deletions).toBe(1)
  })

  it('nao conta os marcadores +++/--- como linhas', () => {
    const s = summarizeDiff('--- a/x\n+++ b/x\n+uma')
    expect(s.insertions).toBe(1)
    expect(s.deletions).toBe(0)
  })

  it('diff vazio nao inventa alteracao', () => {
    expect(summarizeDiff('')).toEqual({ files: [], insertions: 0, deletions: 0 })
    expect(formatDiffSummary(summarizeDiff(''), 'pt')).toMatch(/nenhuma/)
  })
})

describe('aplicar e opt-in', () => {
  it('usa --3way: resolve o que da e falha alto no conflito', () => {
    // Aplicar meio patch em silencio seria pior que nao aplicar.
    expect(applyDiffCommand('C:/tmp/w1.patch')).toContain('--3way')
  })
})

describe('worktree e prompt', () => {
  it('cada worker recebe branch e pasta proprios', () => {
    const a = planImplementer('D:/proj', 'corrigir login', 1)
    const b = planImplementer('D:/proj', 'corrigir login', 2)
    expect(a.dir).not.toBe(b.dir)
    expect(a.branch).not.toBe(b.branch)
    expect(a.dir).toContain('.openclaude-worktrees')
  })

  it('o prompt diz a pasta e proibe sair dela', () => {
    const p = implementerSystemPrompt('pt', WT, true)
    expect(p).toContain(WT)
    expect(p).toMatch(/recusada/i)
    expect(p).toMatch(/RODE o teste/i)
  })

  it('sem execucao, o prompt PARA de mandar rodar teste', () => {
    const p = implementerSystemPrompt('pt', WT, false)
    expect(p).toMatch(/DESLIGADA/)
    expect(p).not.toMatch(/RODE o teste/i)
  })
})
