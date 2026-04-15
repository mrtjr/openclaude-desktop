// ─── useScheduledTasks ──────────────────────────────────────────────
// Manages scheduled tasks with localStorage persistence and a polling
// scheduler (checks every 30s whether any task is due).

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ScheduledTask, TaskSchedule } from '../types/schedule'
import { TASKS_STORAGE_KEY } from '../types/schedule'

// ── Helpers ──────────────────────────────────────────────────────────

function loadTasks(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { console.warn('[scheduler] load error:', e) }
  return []
}

function saveTasks(tasks: ScheduledTask[]) {
  localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks))
}

/** Calculate the next run epoch for a given schedule from `now`. */
export function calcNextRun(schedule: TaskSchedule, fromMs: number = Date.now()): number {
  const now = new Date(fromMs)

  if (schedule.type === 'interval') {
    const mins = Math.max(1, schedule.intervalMinutes ?? 60) // floor at 1 minute
    return fromMs + mins * 60_000
  }

  // Parse HH:MM
  const [hh, mm] = (schedule.time ?? '09:00').split(':').map(Number)

  if (schedule.type === 'daily') {
    const next = new Date(now)
    next.setHours(hh, mm, 0, 0)
    if (next.getTime() <= fromMs) next.setDate(next.getDate() + 1)
    return next.getTime()
  }

  if (schedule.type === 'weekly') {
    const target = schedule.dayOfWeek ?? 1 // Monday default
    const next = new Date(now)
    next.setHours(hh, mm, 0, 0)
    let diff = target - next.getDay()
    if (diff < 0 || (diff === 0 && next.getTime() <= fromMs)) diff += 7
    next.setDate(next.getDate() + diff)
    return next.getTime()
  }

  return fromMs + 3600_000 // fallback: 1h
}

const CHECK_INTERVAL_MS = 30_000 // poll every 30s

// ── Hook ─────────────────────────────────────────────────────────────

export interface UseScheduledTasksOptions {
  /** Called when a task fires. Should create a conversation and send the prompt. */
  onTaskFire?: (task: ScheduledTask) => void
  /** Master switch — disable to pause all scheduling without removing tasks. */
  enabled?: boolean
}

export function useScheduledTasks(opts: UseScheduledTasksOptions = {}) {
  const { onTaskFire, enabled = true } = opts
  const [tasks, setTasks] = useState<ScheduledTask[]>(loadTasks)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const onTaskFireRef = useRef(onTaskFire)
  onTaskFireRef.current = onTaskFire

  // ── Scheduler loop ────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return

    const tick = () => {
      const now = Date.now()
      let changed = false
      const updated = tasksRef.current.map(t => {
        if (!t.enabled || !t.nextRun) return t
        if (now < t.nextRun) return t
        // Task is due!
        changed = true
        onTaskFireRef.current?.(t)
        return {
          ...t,
          lastRun: now,
          nextRun: calcNextRun(t.schedule, now),
        }
      })
      if (changed) {
        tasksRef.current = updated
        setTasks(updated)
        saveTasks(updated)
      }
    }

    // Delay initial check to let the app fully mount (sendMessageRef, etc.)
    const initialTimeout = setTimeout(tick, 2000)
    const id = setInterval(tick, CHECK_INTERVAL_MS)
    return () => { clearTimeout(initialTimeout); clearInterval(id) }
  }, [enabled])

  // ── CRUD ──────────────────────────────────────────────────────

  const create = useCallback((data: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'createdConversationIds' | 'nextRun'>) => {
    const now = Date.now()
    const task: ScheduledTask = {
      ...data,
      id: `task-${now}-${Math.random().toString(36).slice(2, 8)}`,
      nextRun: data.enabled ? calcNextRun(data.schedule, now) : undefined,
      createdConversationIds: [],
      createdAt: now,
      updatedAt: now,
    }
    setTasks(prev => {
      const next = [...prev, task]
      saveTasks(next)
      return next
    })
    return task
  }, [])

  const update = useCallback((id: string, changes: Partial<ScheduledTask>) => {
    setTasks(prev => {
      const next = prev.map(t => {
        if (t.id !== id) return t
        const merged = { ...t, ...changes, updatedAt: Date.now() }
        // Recalculate nextRun if schedule or enabled changed
        if (changes.schedule || changes.enabled !== undefined) {
          merged.nextRun = merged.enabled ? calcNextRun(merged.schedule) : undefined
        }
        return merged
      })
      saveTasks(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setTasks(prev => {
      const next = prev.filter(t => t.id !== id)
      saveTasks(next)
      return next
    })
  }, [])

  const toggle = useCallback((id: string) => {
    setTasks(prev => {
      const next = prev.map(t => {
        if (t.id !== id) return t
        const enabled = !t.enabled
        return {
          ...t,
          enabled,
          nextRun: enabled ? calcNextRun(t.schedule) : undefined,
          updatedAt: Date.now(),
        }
      })
      saveTasks(next)
      return next
    })
  }, [])

  const runNow = useCallback((id: string) => {
    const task = tasksRef.current.find(t => t.id === id)
    if (!task) return
    onTaskFireRef.current?.(task)
    setTasks(prev => {
      const now = Date.now()
      const next = prev.map(t =>
        t.id === id
          ? { ...t, lastRun: now, nextRun: t.enabled ? calcNextRun(t.schedule, now) : undefined }
          : t
      )
      saveTasks(next)
      return next
    })
  }, [])

  return {
    tasks,
    create,
    update,
    remove,
    toggle,
    runNow,
    enabledCount: tasks.filter(t => t.enabled).length,
    totalCount: tasks.length,
  }
}
