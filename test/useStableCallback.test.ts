import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStableCallback } from '../src/hooks/useStableCallback'

describe('useStableCallback', () => {
  it('keeps the SAME identity across re-renders even when fn changes', () => {
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: () => 'a' },
    })
    const first = result.current
    rerender({ fn: () => 'b' })
    expect(result.current).toBe(first)
  })

  it('always invokes the LATEST fn (no stale closure)', () => {
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: () => 'a' },
    })
    expect(result.current()).toBe('a')
    rerender({ fn: () => 'b' })
    expect(result.current()).toBe('b')
  })

  it('forwards arguments and return value', () => {
    const { result } = renderHook(() => useStableCallback((x: number, y: number) => x + y))
    expect(result.current(2, 3)).toBe(5)
  })
})
