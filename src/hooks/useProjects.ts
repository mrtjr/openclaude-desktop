import { useState, useEffect, useCallback } from 'react'
import type { Project } from '../types'
import { generateId } from '../utils/formatting'
import { colorForIndex, validateProjectName } from '../utils/projects'

// Projects are light metadata (name + color), so they live in localStorage like
// pinned conversations — not the userData conversation store. Conversations
// reference a project via `projectId`.
const STORAGE_KEY = 'openclaude-projects'

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((p: any) => ({ ...p, createdAt: new Date(p.createdAt) }))
  } catch { return [] }
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects())
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)) }
    catch (e) { console.warn('[projects] save error:', e) }
  }, [projects])

  /** Create a project. Returns the new project (or null when the name is
   *  invalid). Color is computed from the closure's project count, so the
   *  returned object is reliable (no dependence on the async state update). */
  const createProject = useCallback((name: string): Project | null => {
    if (validateProjectName(name)) return null
    const created: Project = {
      id: generateId(),
      name: name.trim(),
      color: colorForIndex(projects.length),
      createdAt: new Date(),
    }
    setProjects(prev => [...prev, created])
    return created
  }, [projects])

  const renameProject = useCallback((id: string, name: string) => {
    if (validateProjectName(name)) return
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, name: name.trim() } : p)))
  }, [])

  /** Patch a project (name, color, instructions…). Ignores a blank name. */
  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    if (patch.name !== undefined && validateProjectName(patch.name)) return
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...patch, ...(patch.name ? { name: patch.name.trim() } : {}) } : p)))
  }, [])

  return {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    createProject,
    renameProject,
    updateProject,
  }
}
