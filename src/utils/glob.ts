// ─── glob_files (copiado do Glob do Claude Code — v2.82.1) ──────────
//
// Acha arquivos por PADRÃO DE NOME (ex.: "**/*.ts", "src/**/*.test.tsx",
// "*.{json,yaml}") — capacidade que faltava: tínhamos list_directory (1 nível),
// search_files (conteúdo) e project_tree (estrutura), mas nada para "ache todos
// os arquivos que casam este padrão". Reusa o IPC workspace-tree (sem IPC novo;
// ignora node_modules/.git/dist e ocultos, profundidade ≤6) e casa os caminhos
// RELATIVOS contra o padrão. Tudo PURO/testável; o IPC é injetado.

import type { TreeNode } from './projectTree'

/** Traduz um glob para RegExp ancorada, case-insensitive (amigável ao Windows).
 *  Suporta: `**` (qualquer nº de diretórios), `*` (qualquer coisa menos "/"),
 *  `?` (um caractere menos "/"), `{a,b,c}` (alternância). Semântica padrão:
 *  "*.ts" casa só a raiz; "**​/*.ts" casa recursivo. */
export function globToRegExp(glob: string): RegExp {
  const g = (glob || '').replace(/\\/g, '/') // normaliza separadores no padrão
  const SPECIAL = new Set('.+^${}()|[]\\'.split(''))
  const esc = (c: string) => (SPECIAL.has(c) ? '\\' + c : c)
  let re = ''
  let i = 0
  while (i < g.length) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 3; continue } // **/ → zero+ dirs
        re += '.*'; i += 2; continue                                    // ** → tudo
      }
      re += '[^/]*'; i++; continue                                       // * → segmento
    }
    if (c === '?') { re += '[^/]'; i++; continue }
    if (c === '{') {
      const end = g.indexOf('}', i)
      if (end !== -1) {
        const alts = g.slice(i + 1, end).split(',').map(a => a.split('').map(esc).join('')).join('|')
        re += `(?:${alts})`; i = end + 1; continue
      }
      re += '\\{'; i++; continue
    }
    re += esc(c); i++
  }
  return new RegExp('^' + re + '$', 'i')
}

/** Achata a árvore (workspace-tree) em caminhos RELATIVOS de ARQUIVOS, com "/". */
export function flattenTreeFiles(nodes: TreeNode[] | undefined, prefix = ''): string[] {
  const out: string[] = []
  for (const n of nodes || []) {
    if (!n || !n.name) continue
    const rel = prefix ? `${prefix}/${n.name}` : n.name
    if (n.type === 'dir') out.push(...flattenTreeFiles(n.children, rel))
    else out.push(rel)
  }
  return out
}

export const GLOB_MAX_RESULTS = 200

/** Filtra os caminhos que casam o glob. */
export function matchGlob(paths: string[], pattern: string): string[] {
  const re = globToRegExp(pattern)
  return (paths || []).filter(p => re.test(p))
}

/** Formata o resultado do glob_files para o modelo. */
export function formatGlobResults(
  res: { tree?: TreeNode[]; error?: string | null } | null | undefined,
  pattern: string,
  root: string,
  max = GLOB_MAX_RESULTS,
): string {
  if (!res || res.error) return `Não consegui varrer "${root}": ${res?.error || 'erro desconhecido'}.`
  const files = flattenTreeFiles(res.tree || [])
  const matches = matchGlob(files, pattern).sort()
  if (!matches.length) {
    return `Nenhum arquivo casa "${pattern}" em ${root} (node_modules/.git/dist e ocultos ignorados; profundidade ≤6). Dica: use "**/" para buscar recursivo (ex.: "**/*.ts").`
  }
  const shown = matches.slice(0, max)
  const truncated = matches.length > max
  const head = `${matches.length}${truncated ? '+' : ''} arquivo(s) casando "${pattern}" em ${root}:`
  const tail = truncated ? `\n… (${matches.length - max} a mais — refine o padrão)` : ''
  return `${head}\n${shown.join('\n')}${tail}`
}
