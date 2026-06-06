// ─── Projects (workspaces) — pure helpers ───────────────────────────
//
// Projects group related conversations into a workspace (Claude-style). The
// user has dozens of related conversations (trading robots, strategies, code,
// research) and asked for the same organization Claude offers. This module is
// the pure, testable core; persistence + React state live in hooks/useProjects.
//
// v2.12.42 ships organization only (name + color + filtering). Per-project
// custom instructions (injected into the system prompt) and files come next.

import type { Conversation, Project } from '../types'

/** Palette for new project chips — cycles deterministically by creation order. */
export const PROJECT_COLORS = [
  '#e07a5f', '#9b5de5', '#4cc9a0', '#f2cc8f', '#5b9bd5', '#e76f8f', '#81b29a', '#f4845f',
]

/** Pick a color for the Nth project (wraps around the palette). */
export function colorForIndex(index: number): string {
  const i = ((index % PROJECT_COLORS.length) + PROJECT_COLORS.length) % PROJECT_COLORS.length
  return PROJECT_COLORS[i]
}

/** Validate a project name. Returns an error message (pt) or null when valid. */
export function validateProjectName(name: string): string | null {
  const n = (name || '').trim()
  if (!n) return 'O nome do projeto não pode ser vazio.'
  if (n.length > 60) return 'Nome muito longo (máximo 60 caracteres).'
  return null
}

/** Conversations belonging to a project (or, when projectId is null/undefined,
 *  ALL conversations — the "Todas" view). */
export function conversationsInProject(
  conversations: Conversation[],
  projectId: string | null | undefined,
): Conversation[] {
  if (!projectId) return conversations
  return (conversations || []).filter((c) => c.projectId === projectId)
}

/** Count conversations per project id. Conversations with no project are not
 *  counted. Returns a plain map { projectId: count }. */
export function countByProject(conversations: Conversation[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of conversations || []) {
    if (c.projectId) out[c.projectId] = (out[c.projectId] || 0) + 1
  }
  return out
}

/** Build the text appended to the system prompt for a conversation that belongs
 *  to `project`. Returns '' when there's no project or no instructions, so the
 *  caller can append unconditionally. (Projects ciclo 2.) */
export function projectInstructionsAddition(project: Project | null | undefined): string {
  const instr = project?.instructions?.trim()
  if (!instr) return ''
  return `\n\n# Projeto: ${project!.name}\n${instr}`
}

/** Build the working-directory note appended to the system prompt for a
 *  conversation in `project`. The user's #1 tool is execute_command, so a
 *  project tied to a codebase should run its commands + file ops from one
 *  folder. Returns '' when there's no cwd. (Projects ciclo 3.) */
export function projectCwdAddition(project: Project | null | undefined): string {
  const cwd = project?.cwd?.trim()
  if (!cwd) return ''
  return `\n\n# Pasta de trabalho do projeto\nRode todos os comandos (execute_command) e operações de arquivo (read_file, list_directory, write_file) a partir desta pasta, usando caminhos absolutos sob ela: ${cwd}`
}

/** Remove a project from the list and detach it from any conversation that
 *  referenced it (those conversations fall back to "Todas"). Pure — returns new
 *  arrays, mutates nothing. */
export function removeProject(
  projects: Project[],
  conversations: Conversation[],
  projectId: string,
): { projects: Project[]; conversations: Conversation[] } {
  return {
    projects: (projects || []).filter((p) => p.id !== projectId),
    conversations: (conversations || []).map((c) =>
      c.projectId === projectId ? { ...c, projectId: undefined } : c,
    ),
  }
}
