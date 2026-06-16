// ─── Persistent memory write — pure helpers ─────────────────────────
//
// The persistent store ({facts, preferences, projects}) was read every turn
// but NOTHING in the chat flow wrote to it — the model could read facts but
// never record a new one. These helpers back the remember_fact tool: pick the
// bucket, dedupe, and cap growth. Kept pure + tested; the IPC load/save lives
// in useToolExecution.

import type { FreshFact } from './freshFacts'

export type MemoryCategory = 'fact' | 'preference' | 'project'

export interface PersistentMemoryStore {
  facts: string[]
  preferences: string[]
  projects: string[]
  /** Cache de fatos frescos verificados (Camada 3, v2.62.0). Preservado por
   *  normalizeMemory/mergeFact para que remember_fact/aprendizado de preferência
   *  NÃO o apaguem ao salvar. Ver freshFacts.ts. */
  fresh: FreshFact[]
}

/** Per-bucket cap so the injected [PERSISTENT MEMORY] block can't grow without
 *  bound (oldest entries drop first). */
export const MEMORY_BUCKET_CAP = 100

/** Apenas os buckets de string (o bucket `fresh` é estruturado e não passa por
 *  mergeFact). */
type StringBucket = 'facts' | 'preferences' | 'projects'

const CATEGORY_KEY: Record<MemoryCategory, StringBucket> = {
  fact: 'facts',
  preference: 'preferences',
  project: 'projects',
}

/** Coerce whatever loadMemory returned into the full store shape. */
export function normalizeMemory(mem: unknown): PersistentMemoryStore {
  const m = (mem || {}) as Partial<PersistentMemoryStore>
  return {
    facts: Array.isArray(m.facts) ? m.facts : [],
    preferences: Array.isArray(m.preferences) ? m.preferences : [],
    projects: Array.isArray(m.projects) ? m.projects : [],
    // Preserva o bucket de fatos frescos (não-string) intacto no round-trip.
    fresh: Array.isArray(m.fresh) ? m.fresh : [],
  }
}

/** Add `value` to the bucket for `category`, de-duplicated case-insensitively
 *  and capped at MEMORY_BUCKET_CAP. Returns the new store, whether anything
 *  was added, and the resolved bucket key. An unknown category falls back to
 *  'facts'. */
export function mergeFact(
  mem: unknown,
  category: unknown,
  value: unknown,
): { memory: PersistentMemoryStore; added: boolean; bucket: StringBucket } {
  const store = normalizeMemory(mem)
  const cat = (['fact', 'preference', 'project'] as const).includes(category as MemoryCategory)
    ? (category as MemoryCategory)
    : 'fact'
  const bucket = CATEGORY_KEY[cat]
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return { memory: store, added: false, bucket }
  const exists = store[bucket].some((x) => x.trim().toLowerCase() === v.toLowerCase())
  if (exists) return { memory: store, added: false, bucket }
  const next = [...store[bucket], v]
  while (next.length > MEMORY_BUCKET_CAP) next.shift()
  return { memory: { ...store, [bucket]: next }, added: true, bucket }
}
