// ─── useProfiles ────────────────────────────────────────────────────
// CRUD hook for Agent Profiles with localStorage persistence.

import { useState, useCallback, useMemo } from 'react'
import type { AgentProfile } from '../types/profile'
import { BUILT_IN_PROFILES, PROFILES_STORAGE_KEY } from '../types/profile'

function loadCustomProfiles(): AgentProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { console.warn('[profiles] load error:', e) }
  return []
}

function saveCustomProfiles(profiles: AgentProfile[]) {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles))
}

export function useProfiles() {
  const [customProfiles, setCustomProfiles] = useState<AgentProfile[]>(loadCustomProfiles)
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => {
    return localStorage.getItem('openclaude-active-profile') || null
  })

  const allProfiles = useMemo(
    () => [...BUILT_IN_PROFILES, ...customProfiles],
    [customProfiles]
  )

  const activeProfile = useMemo(
    () => allProfiles.find(p => p.id === activeProfileId) ?? null,
    [allProfiles, activeProfileId]
  )

  const activate = useCallback((profileId: string | null) => {
    setActiveProfileId(profileId)
    if (profileId) {
      localStorage.setItem('openclaude-active-profile', profileId)
    } else {
      localStorage.removeItem('openclaude-active-profile')
    }
  }, [])

  const create = useCallback((profile: Omit<AgentProfile, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const newProfile: AgentProfile = {
      ...profile,
      id: `profile-${now}-${Math.random().toString(36).slice(2, 8)}`,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    }
    setCustomProfiles(prev => {
      const next = [...prev, newProfile]
      saveCustomProfiles(next)
      return next
    })
    return newProfile
  }, [])

  const update = useCallback((id: string, changes: Partial<AgentProfile>) => {
    setCustomProfiles(prev => {
      const next = prev.map(p =>
        p.id === id ? { ...p, ...changes, updatedAt: Date.now() } : p
      )
      saveCustomProfiles(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setCustomProfiles(prev => {
      const next = prev.filter(p => p.id !== id)
      saveCustomProfiles(next)
      return next
    })
    // Deactivate if the removed profile was active
    if (activeProfileId === id) activate(null)
  }, [activeProfileId, activate])

  const duplicate = useCallback((id: string) => {
    const source = allProfiles.find(p => p.id === id)
    if (!source) return null
    return create({
      name: `${source.name} (copy)`,
      icon: source.icon,
      description: source.description,
      systemPrompt: source.systemPrompt,
      provider: source.provider,
      model: source.model,
      temperature: source.temperature,
      maxTokens: source.maxTokens,
      permissionLevel: source.permissionLevel,
    })
  }, [allProfiles, create])

  return {
    allProfiles,
    customProfiles,
    activeProfile,
    activeProfileId,
    activate,
    create,
    update,
    remove,
    duplicate,
  }
}
