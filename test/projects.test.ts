import { describe, it, expect } from 'vitest'
import {
  PROJECT_COLORS, colorForIndex, validateProjectName,
  conversationsInProject, countByProject, removeProject,
} from '../src/utils/projects'
import type { Conversation, Project } from '../src/types'

const conv = (id: string, projectId?: string): Conversation =>
  ({ id, title: id, messages: [], createdAt: new Date(0), ...(projectId ? { projectId } : {}) })
const proj = (id: string): Project => ({ id, name: id, createdAt: new Date(0) })

describe('validateProjectName', () => {
  it('rejects empty / whitespace names', () => {
    expect(validateProjectName('')).toBeTruthy()
    expect(validateProjectName('   ')).toBeTruthy()
  })
  it('rejects names over 60 chars', () => {
    expect(validateProjectName('x'.repeat(61))).toBeTruthy()
  })
  it('accepts a normal name', () => {
    expect(validateProjectName('Robô Scalping')).toBeNull()
  })
})

describe('colorForIndex', () => {
  it('wraps around the palette and never returns undefined', () => {
    expect(colorForIndex(0)).toBe(PROJECT_COLORS[0])
    expect(colorForIndex(PROJECT_COLORS.length)).toBe(PROJECT_COLORS[0])
    expect(colorForIndex(-1)).toBe(PROJECT_COLORS[PROJECT_COLORS.length - 1])
  })
})

describe('conversationsInProject', () => {
  const convs = [conv('a', 'p1'), conv('b', 'p2'), conv('c'), conv('d', 'p1')]
  it('returns all conversations for the "Todas" view (null/undefined)', () => {
    expect(conversationsInProject(convs, null)).toHaveLength(4)
    expect(conversationsInProject(convs, undefined)).toHaveLength(4)
  })
  it('filters to a single project', () => {
    expect(conversationsInProject(convs, 'p1').map(c => c.id)).toEqual(['a', 'd'])
    expect(conversationsInProject(convs, 'p2').map(c => c.id)).toEqual(['b'])
  })
})

describe('countByProject', () => {
  it('counts conversations per project, ignoring unassigned ones', () => {
    const counts = countByProject([conv('a', 'p1'), conv('b', 'p1'), conv('c', 'p2'), conv('d')])
    expect(counts).toEqual({ p1: 2, p2: 1 })
  })
  it('handles an empty list', () => {
    expect(countByProject([])).toEqual({})
  })
})

describe('removeProject', () => {
  it('drops the project and detaches its conversations (no mutation)', () => {
    const projects = [proj('p1'), proj('p2')]
    const convs = [conv('a', 'p1'), conv('b', 'p2'), conv('c', 'p1')]
    const out = removeProject(projects, convs, 'p1')
    expect(out.projects.map(p => p.id)).toEqual(['p2'])
    expect(out.conversations.find(c => c.id === 'a')!.projectId).toBeUndefined()
    expect(out.conversations.find(c => c.id === 'c')!.projectId).toBeUndefined()
    expect(out.conversations.find(c => c.id === 'b')!.projectId).toBe('p2')
    // original arrays untouched
    expect(projects).toHaveLength(2)
    expect(convs.find(c => c.id === 'a')!.projectId).toBe('p1')
  })
})
