import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScheduledTasks, calcNextRun } from '../src/hooks/useScheduledTasks'
import { TASKS_STORAGE_KEY } from '../src/types/schedule'

describe('calcNextRun', () => {
  it('returns fromMs + intervalMinutes*60_000 for interval schedules', () => {
    const base = 1_700_000_000_000
    const next = calcNextRun({ type: 'interval', intervalMinutes: 15 }, base)
    expect(next - base).toBe(15 * 60_000)
  })

  it('floors interval at 1 minute when intervalMinutes is 0 or missing', () => {
    const base = 1_700_000_000_000
    expect(calcNextRun({ type: 'interval', intervalMinutes: 0 }, base) - base).toBe(60_000)
    expect(calcNextRun({ type: 'interval' }, base) - base).toBe(60 * 60_000) // default 60
  })

  it('daily schedule picks today if HH:MM is still in the future', () => {
    // Build "today at 09:00" anchor in local time
    const noon = new Date()
    noon.setHours(12, 0, 0, 0)
    const next = calcNextRun({ type: 'daily', time: '23:59' }, noon.getTime())
    const d = new Date(next)
    expect(d.getHours()).toBe(23)
    expect(d.getMinutes()).toBe(59)
    expect(d.getDate()).toBe(noon.getDate())
  })

  it('daily schedule rolls to tomorrow if HH:MM already passed', () => {
    const evening = new Date()
    evening.setHours(22, 0, 0, 0)
    const next = calcNextRun({ type: 'daily', time: '09:00' }, evening.getTime())
    const d = new Date(next)
    expect(d.getHours()).toBe(9)
    // Next day (mod month boundaries)
    expect(next).toBeGreaterThan(evening.getTime())
  })

  it('weekly schedule lands on the requested dayOfWeek', () => {
    const anchor = new Date()
    anchor.setHours(10, 0, 0, 0)
    const next = calcNextRun({ type: 'weekly', time: '09:00', dayOfWeek: 3 }, anchor.getTime())
    expect(new Date(next).getDay()).toBe(3)
    expect(next).toBeGreaterThan(anchor.getTime())
  })
})

describe('useScheduledTasks', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('starts empty on first load', () => {
    const { result } = renderHook(() => useScheduledTasks({ enabled: false }))
    expect(result.current.tasks).toEqual([])
    expect(result.current.totalCount).toBe(0)
    expect(result.current.enabledCount).toBe(0)
  })

  it('creates a task, persists it, and computes nextRun when enabled', () => {
    const { result } = renderHook(() => useScheduledTasks({ enabled: false }))
    act(() => {
      result.current.create({
        name: 'Daily', prompt: 'hi',
        schedule: { type: 'interval', intervalMinutes: 10 },
        enabled: true,
      })
    })
    expect(result.current.tasks).toHaveLength(1)
    expect(result.current.tasks[0].nextRun).toBeTypeOf('number')
    expect(result.current.enabledCount).toBe(1)
    const raw = localStorage.getItem(TASKS_STORAGE_KEY)
    expect(raw).toBeTruthy()
  })

  it('create() leaves nextRun undefined when task is disabled', () => {
    const { result } = renderHook(() => useScheduledTasks({ enabled: false }))
    act(() => {
      result.current.create({
        name: 'Off', prompt: '.',
        schedule: { type: 'interval', intervalMinutes: 10 },
        enabled: false,
      })
    })
    expect(result.current.tasks[0].nextRun).toBeUndefined()
    expect(result.current.enabledCount).toBe(0)
  })

  it('toggle() flips enabled and recomputes nextRun', () => {
    const { result } = renderHook(() => useScheduledTasks({ enabled: false }))
    let id = ''
    act(() => {
      const t = result.current.create({
        name: 'T', prompt: 'p',
        schedule: { type: 'interval', intervalMinutes: 5 },
        enabled: false,
      })
      id = t.id
    })
    expect(result.current.tasks[0].nextRun).toBeUndefined()
    act(() => { result.current.toggle(id) })
    expect(result.current.tasks[0].enabled).toBe(true)
    expect(result.current.tasks[0].nextRun).toBeTypeOf('number')
    act(() => { result.current.toggle(id) })
    expect(result.current.tasks[0].enabled).toBe(false)
    expect(result.current.tasks[0].nextRun).toBeUndefined()
  })

  it('update() changing schedule recalculates nextRun', () => {
    const { result } = renderHook(() => useScheduledTasks({ enabled: false }))
    let id = ''
    act(() => {
      const t = result.current.create({
        name: 'T', prompt: 'p',
        schedule: { type: 'interval', intervalMinutes: 5 },
        enabled: true,
      })
      id = t.id
    })
    const firstNext = result.current.tasks[0].nextRun!
    act(() => {
      result.current.update(id, { schedule: { type: 'interval', intervalMinutes: 120 } })
    })
    const secondNext = result.current.tasks[0].nextRun!
    expect(secondNext).toBeGreaterThan(firstNext)
  })

  it('remove() drops the task from list and storage', () => {
    const { result } = renderHook(() => useScheduledTasks({ enabled: false }))
    let id = ''
    act(() => {
      const t = result.current.create({
        name: 'T', prompt: 'p',
        schedule: { type: 'interval', intervalMinutes: 5 },
        enabled: true,
      })
      id = t.id
    })
    act(() => { result.current.remove(id) })
    expect(result.current.tasks).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(TASKS_STORAGE_KEY)!)).toEqual([])
  })

  it('runNow() fires the onTaskFire callback and updates lastRun', () => {
    const onFire = vi.fn()
    const { result } = renderHook(() => useScheduledTasks({ enabled: false, onTaskFire: onFire }))
    let id = ''
    act(() => {
      const t = result.current.create({
        name: 'Now', prompt: 'run',
        schedule: { type: 'interval', intervalMinutes: 60 },
        enabled: true,
      })
      id = t.id
    })
    act(() => { result.current.runNow(id) })
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire.mock.calls[0][0].id).toBe(id)
    expect(result.current.tasks[0].lastRun).toBeTypeOf('number')
  })
})
