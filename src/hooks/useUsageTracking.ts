import { useState, useEffect, useCallback } from 'react'
import { getModelPricing, formatCost, calculateCost, modalGpuCost, MODAL_DEFAULT_GPU_RATE } from '../constants/pricing'

export interface UsageEntry {
  timestamp: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  /** v2.125.0 — segundos de GPU faturados (Modal); custo = gpuSeconds × rate. */
  gpuSeconds?: number
  /** v2.125.0 — true quando o custo é ESTIMADO por duração (Modal), não por token. */
  estimated?: boolean
}

export interface UsageSummary {
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  byProvider: Record<string, { cost: number; inputTokens: number; outputTokens: number; count: number }>
  byModel: Record<string, { cost: number; count: number }>
  entries: UsageEntry[]
}

const STORAGE_KEY = 'openclaude-usage'
const MAX_ENTRIES = 1000

function loadUsage(): UsageEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveUsage(entries: UsageEntry[]) {
  // Keep only last MAX_ENTRIES
  const trimmed = entries.slice(-MAX_ENTRIES)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

export function useUsageTracking() {
  const [entries, setEntries] = useState<UsageEntry[]>(loadUsage)

  // Record a new usage entry. `opts.durationMs`/`opts.gpuRate` ligam o custo por
  // GPU-segundo do Modal (v2.125.0) — provedor que NÃO cobra por token.
  const recordUsage = useCallback((provider: string, model: string, inputTokens: number, outputTokens: number, opts?: { durationMs?: number; gpuRate?: number }) => {
    const isModal = provider === 'modal'
    const gpuSeconds = isModal && opts?.durationMs ? Math.max(0, opts.durationMs) / 1000 : undefined
    const cost = isModal && opts?.durationMs
      ? modalGpuCost(opts.durationMs, opts.gpuRate ?? MODAL_DEFAULT_GPU_RATE)
      : calculateCost(inputTokens, outputTokens, model)
    const entry: UsageEntry = {
      timestamp: Date.now(),
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
      ...(gpuSeconds !== undefined ? { gpuSeconds, estimated: true } : {}),
    }
    setEntries(prev => {
      // Trim in-memory too — otherwise the React state grows unbounded
      // across long sessions while the on-disk copy is capped at
      // MAX_ENTRIES, diverging after the 1001st entry and leaking
      // memory into every getSummary iteration.
      const updated = [...prev, entry].slice(-MAX_ENTRIES)
      saveUsage(updated)
      return updated
    })
  }, [])

  // Get summary for a time period (default: last 30 days)
  const getSummary = useCallback((days: number = 30): UsageSummary => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const filtered = entries.filter(e => e.timestamp >= cutoff)

    const byProvider: UsageSummary['byProvider'] = {}
    const byModel: UsageSummary['byModel'] = {}
    let totalCost = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0

    for (const e of filtered) {
      totalCost += e.cost
      totalInputTokens += e.inputTokens
      totalOutputTokens += e.outputTokens

      if (!byProvider[e.provider]) byProvider[e.provider] = { cost: 0, inputTokens: 0, outputTokens: 0, count: 0 }
      byProvider[e.provider].cost += e.cost
      byProvider[e.provider].inputTokens += e.inputTokens
      byProvider[e.provider].outputTokens += e.outputTokens
      byProvider[e.provider].count++

      if (!byModel[e.model]) byModel[e.model] = { cost: 0, count: 0 }
      byModel[e.model].cost += e.cost
      byModel[e.model].count++
    }

    return { totalCost, totalInputTokens, totalOutputTokens, byProvider, byModel, entries: filtered }
  }, [entries])

  // Get today's cost
  const getTodayCost = useCallback((): number => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cutoff = today.getTime()
    return entries.filter(e => e.timestamp >= cutoff).reduce((sum, e) => sum + e.cost, 0)
  }, [entries])

  // Clear all usage data
  const clearUsage = useCallback(() => {
    setEntries([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return { entries, recordUsage, getSummary, getTodayCost, clearUsage, formatCost }
}
