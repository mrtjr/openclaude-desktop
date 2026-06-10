import { describe, it, expect } from 'vitest'
import { renderWorkingMemory, renderPersistentMemory } from '../src/utils/memoryRender'

describe('renderWorkingMemory', () => {
  it('renders the exact per-step reminder shape', () => {
    const out = renderWorkingMemory({ current_goal: 'corrigir EA', done_steps: 'li o log', open_tasks: 'compilar' })
    expect(out).toBe('[URGENT WORKING MEMORY STATE]\nGoal: corrigir EA\nDone: li o log\nPending: compilar')
  })
  it('fills missing fields with None and returns empty for no memory', () => {
    expect(renderWorkingMemory({})).toContain('Goal: None')
    expect(renderWorkingMemory(null)).toBe('')
    expect(renderWorkingMemory(undefined)).toBe('')
  })
})

describe('renderPersistentMemory', () => {
  it('renders only the non-empty sections', () => {
    const out = renderPersistentMemory({ facts: ['usa MT5'], preferences: [], projects: ['robo scalper'] })
    expect(out).toContain('[PERSISTENT MEMORY]')
    expect(out).toContain('Facts: usa MT5')
    expect(out).toContain('Projects: robo scalper')
    expect(out).not.toContain('Preferences')
  })
  it('returns empty string when there is nothing to render', () => {
    expect(renderPersistentMemory({})).toBe('')
    expect(renderPersistentMemory(null)).toBe('')
    expect(renderPersistentMemory({ facts: [] })).toBe('')
  })
})
