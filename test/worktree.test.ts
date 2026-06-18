import { describe, it, expect } from 'vitest'
import { slugifyLabel, planWorktree, WORKTREE_LIST_COMMAND } from '../src/utils/worktree'

describe('slugifyLabel', () => {
  it('normaliza acentos, espaços e símbolos', () => {
    expect(slugifyLabel('Refatorar Autenticação!')).toBe('refatorar-autenticacao')
    expect(slugifyLabel('  fix: bug #42  ')).toBe('fix-bug-42')
  })
  it('vazio/indefinido → "task"', () => {
    expect(slugifyLabel('')).toBe('task')
    expect(slugifyLabel(undefined)).toBe('task')
    expect(slugifyLabel('!!!')).toBe('task')
  })
  it('trunca em 40 chars', () => {
    expect(slugifyLabel('a'.repeat(60)).length).toBe(40)
  })
})

describe('planWorktree', () => {
  it('monta branch/dir e os comandos git, com sufixo único', () => {
    const p = planWorktree('D:/proj', 'Refatorar Auth', 3)
    expect(p.branch).toBe('oc/refatorar-auth-3')
    expect(p.dir).toBe('D:/proj/.openclaude-worktrees/refatorar-auth-3')
    expect(p.addCommand).toBe('git worktree add "D:/proj/.openclaude-worktrees/refatorar-auth-3" -b "oc/refatorar-auth-3"')
    expect(p.removeCommand).toBe('git worktree remove "D:/proj/.openclaude-worktrees/refatorar-auth-3" --force')
  })
  it('tira barra final do cwd', () => {
    expect(planWorktree('/a/b/', 'x', 1).dir).toBe('/a/b/.openclaude-worktrees/x-1')
  })
  it('WORKTREE_LIST_COMMAND existe', () => {
    expect(WORKTREE_LIST_COMMAND).toBe('git worktree list')
  })
})
