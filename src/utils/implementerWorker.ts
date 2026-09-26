// ─── Subagentes IMPLEMENTADORES em worktree isolado (v2.211.0) ──────
//
// Os subagentes de pesquisa (researchWorker) sao read-only por decisao de
// projeto: e a fronteira que impede um modelo pequeno de estragar a arvore. Um
// implementador PRECISA escrever — entao a fronteira MUDA DE LUGAR em vez de
// sumir: cada worker recebe um git worktree proprio (branch e pasta proprios) e
// so pode tocar o que esta dentro dele. A arvore principal fica intacta o tempo
// todo, e o trabalho volta como DIFF para revisao — nunca como merge automatico.
//
// Este modulo e PURO: allowlist, guard de contencao, prompts e leitura do diff.
// Quem roda git e ferramentas e o useToolExecution.

import { planWorktree, type WorktreePlan } from './worktree'

/** Ferramentas de um implementador: as de leitura do pesquisador MAIS escrita e
 *  execucao. `execute_command` entra porque o valor esta no worker VERIFICAR o
 *  proprio trabalho (build/teste) antes de entregar — sem isso ele devolve
 *  codigo que ninguem rodou. */
export const IMPLEMENTER_TOOL_NAMES = new Set<string>([
  'web_search', 'fetch_url', 'read_file', 'search_files', 'list_directory',
  'glob_files', 'project_tree',
  'write_file', 'edit_file', 'execute_command',
])

/** Ferramentas que NUNCA entram, mesmo que o modelo peca: saem do worktree ou
 *  mexem em estado global. A allowlist acima ja e fechada; esta lista existe
 *  para o TESTE travar a intencao — se alguem adicionar por engano, a suite cai. */
export const IMPLEMENTER_FORBIDDEN = [
  'git_command', 'git_worktree', 'run_workflow', 'install_skills', 'save_skill',
  'delegate_subtasks', 'computer_click', 'browser_navigate', 'open_file_or_url',
  'run_command_background', 'undo_last_write',
]

function norm(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** O caminho esta DENTRO do worktree? E o guard que substitui o read-only:
 *  segment-aware (`/wt-2` nao e `/wt`), recusa `..` e caminho vazio. Na duvida
 *  devolve false — recusar escrita legitima custa o worker reclamar; aceitar
 *  escrita ilegitima custa a arvore principal do usuario. */
export function isInsideWorktree(filePath: string, worktreeDir: string): boolean {
  const raw = String(filePath ?? '')
  if (!raw.trim() || !String(worktreeDir ?? '').trim()) return false
  // `..` em qualquer segmento: recusa sem tentar resolver (a resolucao real
  // depende do FS, e este modulo e puro).
  if (raw.replace(/\\/g, '/').split('/').includes('..')) return false
  const p = norm(raw)
  const base = norm(worktreeDir)
  if (!base) return false
  return p === base || p.startsWith(base + '/')
}

export interface ImplementerPlan extends WorktreePlan { label: string }

/** Planeja o worktree de UM implementador. `suffix` vem de fora (modulo puro). */
export function planImplementer(cwd: string, label: string | undefined, suffix: string | number): ImplementerPlan {
  const plan = planWorktree(cwd, label, suffix)
  return { ...plan, label: String(label ?? 'task') }
}

/** `git add -A` antes do diff e o que faz ARQUIVO NOVO aparecer: sem o add ele
 *  fica untracked, some do relatorio, e o worker parece nao ter feito nada. */
export function diffCommands(dir: string): { stage: string; diff: string; stat: string } {
  const d = '"' + dir + '"'
  return {
    stage: `git -C ${d} add -A`,
    diff: `git -C ${d} diff --cached`,
    stat: `git -C ${d} diff --cached --stat`,
  }
}

export interface DiffSummary { files: string[]; insertions: number; deletions: number }

/** Le o diff unificado direto, sem depender do `--stat` (cujo formato varia
 *  entre versoes do git). */
export function summarizeDiff(diff: string): DiffSummary {
  const text = String(diff ?? '')
  const files: string[] = []
  let insertions = 0
  let deletions = 0
  for (const line of text.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/)
    if (m && m[1] !== 'dev/null') { if (!files.includes(m[1])) files.push(m[1]); continue }
    if (line.startsWith('+') && !line.startsWith('+++')) insertions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { files, insertions, deletions }
}

/** Linha legivel para o orquestrador e para o usuario. */
export function formatDiffSummary(s: DiffSummary, lang: string): string {
  if (!s.files.length) return lang === 'en' ? 'no changes' : 'nenhuma alteracao'
  const f = `${s.files.length} ${lang === 'en' ? 'file(s)' : 'arquivo(s)'}`
  return `${f}, +${s.insertions}/-${s.deletions}`
}

/** Comando para APLICAR o diff na arvore principal. Fica separado de proposito:
 *  nada e aplicado sem o usuario mandar. `--3way` resolve o que da e falha alto
 *  no que conflita, em vez de aplicar meio patch. */
export function applyDiffCommand(patchFile: string): string {
  return `git apply --3way "${patchFile}"`
}

// ─── Prompt do implementador ─────────────────────────────────────
// A regra 1 e a que segura tudo: caminho completo dentro da pasta dele. O
// guard `isInsideWorktree` recusa o resto, mas um worker que ENTENDE a
// fronteira erra menos e gasta menos passos apanhando de recusa.

const PROMPT_PT = (dir: string, canTest: boolean) =>
  `Voce e um subagente IMPLEMENTADOR. Voce tem uma copia isolada do projeto, so sua:

[SUA PASTA] ${dir}

REGRAS:
1. So edite arquivos DENTRO de ${dir}. Use SEMPRE o caminho completo comecando por essa pasta. Escrita fora dela e recusada — a arvore principal do usuario nao e sua.
2. Leia antes de escrever: use read_file/search_files/glob_files para entender o codigo atual. Nao reescreva um arquivo inteiro quando edit_file resolve.
3. ${canTest ? 'Depois de mudar, RODE o teste/build relevante com execute_command (na sua pasta) e conserte o que quebrar. Entregar codigo que ninguem executou nao conta como pronto.' : 'A execucao de comandos esta DESLIGADA neste lote: entregue a mudanca e diga o que precisa ser testado.'}
4. Ao terminar, responda com: o que mudou (arquivo por arquivo e por que), o que voce verificou, e o que ficou por fazer ou incerto.
5. Nao faca commit, nao use git, nao toque em outro worktree. O diff e coletado automaticamente.`

const PROMPT_EN = (dir: string, canTest: boolean) =>
  `You are an IMPLEMENTER subagent. You have your own isolated copy of the project:

[YOUR FOLDER] ${dir}

RULES:
1. Only edit files INSIDE ${dir}. Always use the full path starting with that folder. Writes outside it are refused — the user's main tree is not yours.
2. Read before writing: use read_file/search_files/glob_files to understand the current code. Don't rewrite a whole file when edit_file will do.
3. ${canTest ? 'After changing, RUN the relevant test/build with execute_command (in your folder) and fix what breaks. Delivering code nobody ran does not count as done.' : 'Command execution is OFF for this batch: deliver the change and state what needs testing.'}
4. When done, report: what changed (file by file and why), what you verified, and what is left or uncertain.
5. Do not commit, do not use git, do not touch another worktree. The diff is collected automatically.`

export function implementerSystemPrompt(lang: string, dir: string, canTest: boolean): string {
  return lang === 'en' ? PROMPT_EN(dir, canTest) : PROMPT_PT(dir, canTest)
}
