// ─── Memory Dreaming ────────────────────────────────────────────────
// Background memory consolidation inspired by human sleep cycles.
// - Light phase: Extract key facts from recent conversations
// - Deep phase: Consolidate, deduplicate, and score memories
// Works with the existing agent-memory.json system.

export interface MemoryEntry {
  key: string
  value: string
  updatedAt: number
  health?: number  // 0-1, decays over time
  source?: 'user' | 'agent' | 'dreaming'
}

export interface EpisodicEntry {
  summary: string
  timestamp: number
  conversationId: string
  consolidated?: boolean
}

export interface AgentMemory {
  workingMemory: MemoryEntry[]
  episodic: EpisodicEntry[]
  pinned: { content: string; pinnedAt: number }[]
  version: number
  lastDreamTime?: number
  consolidated?: ConsolidatedMemory[]
}

export interface ConsolidatedMemory {
  fact: string
  confidence: number  // 0-1
  sources: string[]   // conversationIds
  createdAt: number
  lastSeen: number
}

// ─── Health Score ────────────────────────────────────────────────
const HALF_LIFE_DAYS = 7
const MIN_HEALTH = 0.1

/** Calculate health score based on time decay */
export function calculateHealth(updatedAt: number, now: number = Date.now()): number {
  const daysSince = (now - updatedAt) / (24 * 60 * 60 * 1000)
  const health = Math.pow(0.5, daysSince / HALF_LIFE_DAYS)
  return Math.max(MIN_HEALTH, health)
}

/** Update health scores on all working memory entries */
export function updateHealthScores(memory: AgentMemory): AgentMemory {
  const now = Date.now()
  return {
    ...memory,
    workingMemory: memory.workingMemory.map(entry => ({
      ...entry,
      health: calculateHealth(entry.updatedAt, now),
    })),
  }
}

// ─── Light Dreaming (extract facts) ─────────────────────────────

/** Extract key facts from unconsolidated episodic memories */
export function lightDream(memory: AgentMemory): AgentMemory {
  const unconsolidated = memory.episodic.filter(e => !e.consolidated)
  if (unconsolidated.length === 0) return memory

  // Simple extraction: each episode summary becomes a consolidated fact
  const newConsolidated: ConsolidatedMemory[] = unconsolidated.map(ep => ({
    fact: ep.summary,
    confidence: 0.8,
    sources: [ep.conversationId],
    createdAt: Date.now(),
    lastSeen: ep.timestamp,
  }))

  // Mark episodes as consolidated
  const updatedEpisodic = memory.episodic.map(ep => {
    if (unconsolidated.includes(ep)) return { ...ep, consolidated: true }
    return ep
  })

  // Merge with existing consolidated, deduplicating similar facts
  const existing = memory.consolidated || []
  const merged = deduplicateConsolidated([...existing, ...newConsolidated])

  return {
    ...memory,
    episodic: updatedEpisodic,
    consolidated: merged,
    lastDreamTime: Date.now(),
  }
}

// ─── Deep Dreaming (consolidate & prune) ────────────────────────

/** Deep consolidation: prune low-health entries, merge duplicates */
export function deepDream(memory: AgentMemory): AgentMemory {
  let updated = updateHealthScores(memory)

  // Remove low-health working memory entries (< 0.3)
  const HEALTH_THRESHOLD = 0.3
  const healthyEntries = updated.workingMemory.filter(e => (e.health || 1) >= HEALTH_THRESHOLD)
  const prunedCount = updated.workingMemory.length - healthyEntries.length

  // Consolidate memories
  updated = lightDream(updated)

  // Prune old consolidated facts with low confidence
  if (updated.consolidated) {
    updated.consolidated = updated.consolidated
      .filter(c => {
        const age = Date.now() - c.lastSeen
        const ageDays = age / (24 * 60 * 60 * 1000)
        // Keep facts seen recently or with high confidence
        return ageDays < 30 || c.confidence > 0.5
      })
      .slice(-100) // Max 100 consolidated facts
  }

  // Keep max 150 episodic memories
  if (updated.episodic.length > 150) {
    // Prefer keeping unconsolidated and recent
    const unconsolidated = updated.episodic.filter(e => !e.consolidated)
    const consolidated = updated.episodic.filter(e => e.consolidated).slice(-50)
    updated.episodic = [...consolidated, ...unconsolidated].slice(-150)
  }

  return {
    ...updated,
    workingMemory: healthyEntries,
    lastDreamTime: Date.now(),
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/** Simple deduplication based on string similarity */
function deduplicateConsolidated(entries: ConsolidatedMemory[]): ConsolidatedMemory[] {
  const result: ConsolidatedMemory[] = []

  for (const entry of entries) {
    const existing = result.find(e => isSimilar(e.fact, entry.fact))
    if (existing) {
      // Merge: boost confidence, update lastSeen, merge sources
      existing.confidence = Math.min(1, existing.confidence + 0.1)
      existing.lastSeen = Math.max(existing.lastSeen, entry.lastSeen)
      existing.sources = [...new Set([...existing.sources, ...entry.sources])]
    } else {
      result.push({ ...entry })
    }
  }

  return result
}

/** Check if two strings are similar enough to be considered duplicates */
function isSimilar(a: string, b: string): boolean {
  if (a === b) return true
  const aLower = a.toLowerCase().trim()
  const bLower = b.toLowerCase().trim()
  if (aLower === bLower) return true

  // Check if one contains the other
  if (aLower.includes(bLower) || bLower.includes(aLower)) return true

  // Simple word overlap (Jaccard similarity)
  const aWords = new Set(aLower.split(/\s+/))
  const bWords = new Set(bLower.split(/\s+/))
  const intersection = [...aWords].filter(w => bWords.has(w)).length
  const union = new Set([...aWords, ...bWords]).size
  return union > 0 && intersection / union > 0.7
}

// ─── Dream Scheduler ────────────────────────────────────────────

/** Check if it's time for a dream cycle */
export function shouldDream(memory: AgentMemory, type: 'light' | 'deep'): boolean {
  const lastDream = memory.lastDreamTime || 0
  const timeSince = Date.now() - lastDream
  const hours = timeSince / (60 * 60 * 1000)

  if (type === 'light') {
    // Light dream every 2 hours of active use
    return hours >= 2 && memory.episodic.some(e => !e.consolidated)
  }

  // Deep dream every 24 hours
  return hours >= 24
}
