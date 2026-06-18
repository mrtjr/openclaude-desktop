// ─── Worktree isolation (v2.102.0) ──────────────────────────────────
//
// Porta a ideia do "background sessions edit via isolated worktrees" do Claude
// Code: para edições PARALELAS/arriscadas, a IA pode criar um git worktree
// isolado (branch próprio, pasta própria), trabalhar lá sem tocar a árvore
// principal e depois remover/mesclar. Aqui mora a parte PURA (planejar nomes e
// comandos); o useToolExecution roda os comandos git. Tudo testável.

/** Transforma um rótulo livre num slug seguro p/ branch/pasta. */
export function slugifyLabel(label: string | undefined): string {
  return String(label ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task'
}

export interface WorktreePlan {
  branch: string
  dir: string
  addCommand: string
  removeCommand: string
}

/** Planeja um worktree para `label` sob `cwd`. `suffix` distingue worktrees do
 *  mesmo rótulo (passado de fora — o módulo é puro, sem Date.now). */
export function planWorktree(cwd: string, label: string | undefined, suffix: string | number): WorktreePlan {
  const base = String(cwd ?? '').replace(/[\\/]+$/, '')
  const name = `${slugifyLabel(label)}-${suffix}`
  const dir = `${base}/.openclaude-worktrees/${name}`
  const branch = `oc/${name}`
  return {
    branch,
    dir,
    addCommand: `git worktree add "${dir}" -b "${branch}"`,
    removeCommand: `git worktree remove "${dir}" --force`,
  }
}

/** Comando para listar worktrees. */
export const WORKTREE_LIST_COMMAND = 'git worktree list'
