import { describe, it, expect } from 'vitest'
import { isSubagentDelegationAllowed, HIGH_EFFORT_LEVELS } from '../src/utils/subagentGating'

describe('subagentGating', () => {
  it('identifies high/ultracode effort levels correctly', () => {
    expect(HIGH_EFFORT_LEVELS.has('high')).toBe(true)
    expect(HIGH_EFFORT_LEVELS.has('xhigh')).toBe(true)
    expect(HIGH_EFFORT_LEVELS.has('max')).toBe(true)
    expect(HIGH_EFFORT_LEVELS.has('ultracode')).toBe(true)
  })

  it('allows subagent delegation for high / ultracode reasoning effort levels', () => {
    expect(isSubagentDelegationAllowed('high')).toBe(true)
    expect(isSubagentDelegationAllowed('HIGH')).toBe(true)
    expect(isSubagentDelegationAllowed('xhigh')).toBe(true)
    expect(isSubagentDelegationAllowed('max')).toBe(true)
    expect(isSubagentDelegationAllowed('ultracode')).toBe(true)
    expect(isSubagentDelegationAllowed(' ULTRACODE ')).toBe(true)
  })

  it('disallows subagent delegation for off / low / medium / default / undefined effort levels', () => {
    expect(isSubagentDelegationAllowed('off')).toBe(false)
    expect(isSubagentDelegationAllowed('low')).toBe(false)
    expect(isSubagentDelegationAllowed('medium')).toBe(false)
    expect(isSubagentDelegationAllowed('default')).toBe(false)
    expect(isSubagentDelegationAllowed(undefined)).toBe(false)
    expect(isSubagentDelegationAllowed('')).toBe(false)
  })
})
