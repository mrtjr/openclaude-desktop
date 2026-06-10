// ─── Memory rendering — single source ───────────────────────────────
//
// The exact strings injected into the request for the agent's working
// memory and the persistent memory. Centralized so the Context Window
// panel counts PRECISELY what the chat pipeline injects — before this,
// useChat built these strings inline and the panel ignored both, showing
// "Memória / resumo: 0" even when memory was being sent every turn.

export interface WorkingMemoryState {
  current_goal?: string
  done_steps?: string
  open_tasks?: string
}

export interface PersistentMemory {
  facts?: string[]
  preferences?: string[]
  projects?: string[]
}

/** The per-step system reminder injected in agent mode. */
export function renderWorkingMemory(wm: WorkingMemoryState | null | undefined): string {
  if (!wm) return ''
  return `[URGENT WORKING MEMORY STATE]\nGoal: ${wm.current_goal || 'None'}\nDone: ${wm.done_steps || 'None'}\nPending: ${wm.open_tasks || 'None'}`
}

/** The persistent-memory block injected when settings.memoryEnabled. */
export function renderPersistentMemory(mem: PersistentMemory | null | undefined): string {
  if (!mem) return ''
  const parts: string[] = []
  if (mem.facts?.length) parts.push(`Facts: ${mem.facts.join('; ')}`)
  if (mem.preferences?.length) parts.push(`Preferences: ${mem.preferences.join('; ')}`)
  if (mem.projects?.length) parts.push(`Projects: ${mem.projects.join('; ')}`)
  return parts.length > 0 ? `[PERSISTENT MEMORY]\n${parts.join('\n')}` : ''
}
