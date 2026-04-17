import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProfiles } from '../src/hooks/useProfiles'
import { BUILT_IN_PROFILES, PROFILES_STORAGE_KEY } from '../src/types/profile'

describe('useProfiles', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('merges BUILT_IN_PROFILES with empty custom list on first load', () => {
    const { result } = renderHook(() => useProfiles())
    expect(result.current.allProfiles.length).toBe(BUILT_IN_PROFILES.length)
    expect(result.current.customProfiles).toEqual([])
    expect(result.current.activeProfile).toBeNull()
    expect(result.current.activeProfileId).toBeNull()
  })

  it('loads custom profiles from localStorage', () => {
    const stored = [{
      id: 'custom-1', name: 'Mine', icon: '🔥', description: 'x',
      isBuiltIn: false, createdAt: 1, updatedAt: 1,
    }]
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(stored))
    const { result } = renderHook(() => useProfiles())
    expect(result.current.customProfiles).toHaveLength(1)
    expect(result.current.allProfiles).toHaveLength(BUILT_IN_PROFILES.length + 1)
  })

  it('creates a new profile and persists it', () => {
    const { result } = renderHook(() => useProfiles())
    act(() => {
      result.current.create({
        name: 'Tester', icon: '🧪', description: 'for tests',
        temperature: 0.2,
      })
    })
    expect(result.current.customProfiles).toHaveLength(1)
    expect(result.current.customProfiles[0].name).toBe('Tester')
    expect(result.current.customProfiles[0].isBuiltIn).toBe(false)
    expect(result.current.customProfiles[0].id).toMatch(/^profile-/)
    // Persisted
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toHaveLength(1)
  })

  it('updates an existing custom profile', () => {
    const { result } = renderHook(() => useProfiles())
    let id = ''
    act(() => {
      const p = result.current.create({ name: 'A', icon: '🔧', description: '' })
      id = p.id
    })
    act(() => { result.current.update(id, { name: 'B' }) })
    expect(result.current.customProfiles[0].name).toBe('B')
    expect(result.current.customProfiles[0].updatedAt).toBeGreaterThanOrEqual(
      result.current.customProfiles[0].createdAt
    )
  })

  it('removes a custom profile', () => {
    const { result } = renderHook(() => useProfiles())
    let id = ''
    act(() => {
      const p = result.current.create({ name: 'X', icon: '❌', description: '' })
      id = p.id
    })
    expect(result.current.customProfiles).toHaveLength(1)
    act(() => { result.current.remove(id) })
    expect(result.current.customProfiles).toHaveLength(0)
  })

  it('deactivates the active profile when it is removed', () => {
    const { result } = renderHook(() => useProfiles())
    let id = ''
    act(() => {
      const p = result.current.create({ name: 'X', icon: '❌', description: '' })
      id = p.id
    })
    act(() => { result.current.activate(id) })
    expect(result.current.activeProfileId).toBe(id)
    act(() => { result.current.remove(id) })
    expect(result.current.activeProfileId).toBeNull()
  })

  it('activate() persists the active id to localStorage', () => {
    const { result } = renderHook(() => useProfiles())
    const builtIn = BUILT_IN_PROFILES[0].id
    act(() => { result.current.activate(builtIn) })
    expect(localStorage.getItem('openclaude-active-profile')).toBe(builtIn)
    expect(result.current.activeProfile?.id).toBe(builtIn)
    act(() => { result.current.activate(null) })
    expect(localStorage.getItem('openclaude-active-profile')).toBeNull()
  })

  it('duplicate() creates a copy of a built-in profile as a new custom one', () => {
    const { result } = renderHook(() => useProfiles())
    const source = BUILT_IN_PROFILES[0]
    act(() => { result.current.duplicate(source.id) })
    expect(result.current.customProfiles).toHaveLength(1)
    const copy = result.current.customProfiles[0]
    expect(copy.name).toBe(`${source.name} (copy)`)
    expect(copy.isBuiltIn).toBe(false)
    expect(copy.systemPrompt).toBe(source.systemPrompt)
  })

  it('duplicate() returns null for unknown id', () => {
    const { result } = renderHook(() => useProfiles())
    let ret: unknown = 'sentinel'
    act(() => { ret = result.current.duplicate('does-not-exist') })
    expect(ret).toBeNull()
  })
})
