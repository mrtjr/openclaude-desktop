import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAccentColor, ACCENT_PRESETS } from '../src/hooks/useAccentColor'

/**
 * useAccentColor reads/writes:
 *   - localStorage.openclaude-accent
 *   - document.documentElement.style.*
 * Both exist in jsdom, so no additional mocking needed.
 */

function resetAccentEnv() {
  localStorage.removeItem('openclaude-accent')
  const root = document.documentElement
  root.style.removeProperty('--accent')
  root.style.removeProperty('--accent-2')
  root.style.removeProperty('--accent-hover')
  root.style.removeProperty('--accent-dim')
  root.style.removeProperty('--accent-border')
}

describe('useAccentColor', () => {
  beforeEach(() => { resetAccentEnv() })

  it('defaults to the terracotta preset when nothing is stored', () => {
    const { result } = renderHook(() => useAccentColor())
    expect(result.current.value).toBe('terracotta')
    expect(result.current.isCustom).toBe(false)
    expect(result.current.currentHex).toBe(ACCENT_PRESETS[0].hex)
  })

  it('restores the saved preset from localStorage', () => {
    localStorage.setItem('openclaude-accent', 'blue')
    const { result } = renderHook(() => useAccentColor())
    expect(result.current.value).toBe('blue')
    const blue = ACCENT_PRESETS.find(p => p.id === 'blue')!
    expect(result.current.currentHex).toBe(blue.hex)
  })

  it('restores a saved custom hex', () => {
    localStorage.setItem('openclaude-accent', '#3b82f6')
    const { result } = renderHook(() => useAccentColor())
    expect(result.current.isCustom).toBe(true)
    expect(result.current.currentHex).toBe('#3b82f6')
  })

  it('writes accent tokens to :root on mount', () => {
    const { result } = renderHook(() => useAccentColor())
    const root = document.documentElement
    // Default should have been applied.
    expect(root.style.getPropertyValue('--accent')).toBe(ACCENT_PRESETS[0].hex)
    expect(root.style.getPropertyValue('--accent-2')).toBe(ACCENT_PRESETS[0].hex2)
    expect(root.style.getPropertyValue('--accent-dim')).toMatch(/^rgba\(/)
    expect(root.style.getPropertyValue('--accent-border')).toMatch(/^rgba\(/)
    void result // silence unused
  })

  it('updates tokens when switching presets', () => {
    const { result } = renderHook(() => useAccentColor())
    act(() => { result.current.setPreset('green') })
    const green = ACCENT_PRESETS.find(p => p.id === 'green')!
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(green.hex)
    expect(localStorage.getItem('openclaude-accent')).toBe('green')
  })

  it('ignores an unknown preset id', () => {
    const { result } = renderHook(() => useAccentColor())
    act(() => { result.current.setPreset('nonexistent') })
    // Value stays on the default.
    expect(result.current.value).toBe('terracotta')
  })

  it('accepts valid custom hex in long and short form', () => {
    const { result } = renderHook(() => useAccentColor())
    act(() => { result.current.setCustomHex('#123456') })
    expect(result.current.value).toBe('#123456')
    expect(result.current.isCustom).toBe(true)
    act(() => { result.current.setCustomHex('#abc') })
    // Expanded to 6 chars, lowercased.
    expect(result.current.value).toBe('#aabbcc')
  })

  it('accepts hex without the leading #', () => {
    const { result } = renderHook(() => useAccentColor())
    act(() => { result.current.setCustomHex('ff00aa') })
    expect(result.current.value).toBe('#ff00aa')
  })

  it('rejects malformed hex strings', () => {
    const { result } = renderHook(() => useAccentColor())
    act(() => { result.current.setCustomHex('not-a-color') })
    // Remained at default.
    expect(result.current.value).toBe('terracotta')
    act(() => { result.current.setCustomHex('#12345') }) // 5 digits = invalid
    expect(result.current.value).toBe('terracotta')
  })

  it('reset() returns to the default preset', () => {
    const { result } = renderHook(() => useAccentColor())
    act(() => { result.current.setPreset('red') })
    expect(result.current.value).toBe('red')
    act(() => { result.current.reset() })
    expect(result.current.value).toBe('terracotta')
  })

  it('exposes the full preset list to consumers', () => {
    const { result } = renderHook(() => useAccentColor())
    expect(result.current.presets).toBe(ACCENT_PRESETS)
    expect(result.current.presets.length).toBe(8)
  })
})
