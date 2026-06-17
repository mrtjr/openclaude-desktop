// ─── Árvore de projeto no chat (fusão do CodeWorkspace — v2.79.0) ───
//
// O CodeWorkspace mostra a árvore recursiva de arquivos do projeto (IPC
// workspace-tree, ignora node_modules/.git/dist…, depth≤6) num painel. A edição
// de código em si já é coberta no chat (read_file/write_file/edit_file/
// search_files/execute_command); o que faltava era essa VISÃO de estrutura em
// UMA chamada (list_directory só faz 1 nível). A ferramenta project_tree traz
// isso. O painel CodeWorkspace segue para a edição com revisão de diff visual.
//
// Helpers PUROS/testáveis: renderizar a árvore (recebida do IPC) em texto
// indentado com teto de entradas. O IPC é injetado pelo chamador.

export interface TreeNode {
  name: string
  path?: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

/** Teto de entradas no texto — uma árvore gigante estouraria o contexto. */
export const PROJECT_TREE_MAX_ENTRIES = 300

export interface RenderTreeResult { text: string; count: number; truncated: boolean }

/** Renderiza a árvore em texto indentado (dirs com "/"). Para no teto e sinaliza
 *  truncamento. Diretórios primeiro já vêm ordenados do IPC; aqui só formata. */
export function renderTree(nodes: TreeNode[] | undefined, max = PROJECT_TREE_MAX_ENTRIES): RenderTreeResult {
  const lines: string[] = []
  let count = 0
  let truncated = false
  const walk = (list: TreeNode[] | undefined, depth: number) => {
    if (!Array.isArray(list)) return
    for (const n of list) {
      if (!n || !n.name) continue
      if (count >= max) { truncated = true; return }
      count++
      lines.push(`${'  '.repeat(depth)}${n.name}${n.type === 'dir' ? '/' : ''}`)
      if (n.type === 'dir' && n.children?.length) {
        walk(n.children, depth + 1)
        if (truncated) return
      }
    }
  }
  walk(nodes, 0)
  return { text: lines.join('\n'), count, truncated }
}

/** Formata o resultado do workspace-tree para o modelo. */
export function formatProjectTree(
  res: { tree?: TreeNode[]; error?: string | null } | null | undefined,
  rootPath: string,
  max = PROJECT_TREE_MAX_ENTRIES,
): string {
  if (!res || res.error) return `Não consegui ler a estrutura de "${rootPath}": ${res?.error || 'erro desconhecido'}.`
  const tree = res.tree || []
  if (!tree.length) return `"${rootPath}" está vazio ou inacessível (node_modules/.git e ocultos são omitidos).`
  const { text, count, truncated } = renderTree(tree, max)
  const head = `Estrutura de ${rootPath} (${count}${truncated ? '+' : ''} itens; node_modules/.git/dist omitidos):`
  const tail = truncated ? `\n… (truncado em ${max} itens — abra uma subpasta com project_tree path=… ou use list_directory/search_files)` : ''
  return `${head}\n${text}${tail}`
}
