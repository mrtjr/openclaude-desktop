import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToast } from '../src/hooks/useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('adds a toast via show(string) with info default severity', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.show('hello') })
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('hello')
    expect(result.current.toasts[0].severity).toBe('info')
  })

  it('adds a toast via show(opts) with explicit severity', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.show({ message: 'Oh no', severity: 'error' }) })
    expect(result.current.toasts[0].severity).toBe('error')
  })

  it('auto-dismisses info toasts after default duration (3s)', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.info('quick message') })
    expect(result.current.toasts).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.toasts).toHaveLength(0)
  })

  it('persists error toasts (duration=0) until manually dismissed', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.error('Network failed') })
    expect(result.current.toasts).toHaveLength(1)

    // Errors should NOT auto-dismiss even after long time
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current.toasts).toHaveLength(1)
  })

  it('dismisses a specific toast by id', () => {
    const { result } = renderHook(() => useToast())
    let firstId: number = 0
    act(() => {
      firstId = result.current.show('first')
      result.current.show('second')
    })
    expect(result.current.toasts).toHaveLength(2)
    act(() => { result.current.dismiss(firstId) })
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('second')
  })

  it('provides typed severity helpers', () => {
    const { result } = renderHook(() => useToast())
    act(() => {
      result.current.success('ok')
      result.current.warn('careful')
      result.current.error('bad')
      result.current.info('fyi')
    })
    const severities = result.current.toasts.map(t => t.severity)
    expect(severities).toEqual(['success', 'warn', 'error', 'info'])
  })

  it('supports action callbacks on toasts', () => {
    const { result } = renderHook(() => useToast())
    const onRetry = vi.fn()
    act(() => {
      result.current.error('Failed', { label: 'Retry', onClick: onRetry })
    })
    expect(result.current.toasts[0].action?.label).toBe('Retry')
    // Action should not auto-fire
    expect(onRetry).not.toHaveBeenCalled()
    // Simulate click
    act(() => { result.current.toasts[0].action?.onClick() })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('respects custom duration on options', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.show({ message: 'quick', duration: 500 }) })
    expect(result.current.toasts).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(499) })
    expect(result.current.toasts).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.toasts).toHaveLength(0)
  })

  it('returns unique incrementing ids', () => {
    const { result } = renderHook(() => useToast())
    let ids: number[] = []
    act(() => {
      ids.push(result.current.show('a'))
      ids.push(result.current.show('b'))
      ids.push(result.current.show('c'))
    })
    expect(new Set(ids).size).toBe(3)
    expect(ids[1]).toBeGreaterThan(ids[0])
    expect(ids[2]).toBeGreaterThan(ids[1])
  })
})
