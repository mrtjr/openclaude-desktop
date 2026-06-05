import { describe, it, expect } from 'vitest'
import { toolNeedsApproval, truncateToolOutput, TOOL_OUTPUT_LIMIT } from '../src/utils/toolPolicy'

describe('toolNeedsApproval', () => {
  it('gates every dangerous tool in ask and planning', () => {
    for (const level of ['ask', 'planning'] as const) {
      expect(toolNeedsApproval(level, 'execute_command')).toBe(true)
      expect(toolNeedsApproval(level, 'write_file')).toBe(true)
      expect(toolNeedsApproval(level, 'git_command')).toBe(true)
      expect(toolNeedsApproval(level, 'browser_navigate')).toBe(true)
    }
  })

  it('lets edit tools through in auto_edits but still gates the rest', () => {
    expect(toolNeedsApproval('auto_edits', 'write_file')).toBe(false)
    expect(toolNeedsApproval('auto_edits', 'git_command')).toBe(false)
    expect(toolNeedsApproval('auto_edits', 'execute_command')).toBe(true) // not an edit tool
    expect(toolNeedsApproval('auto_edits', 'browser_navigate')).toBe(true)
  })

  it('never asks in ignore mode', () => {
    expect(toolNeedsApproval('ignore', 'execute_command')).toBe(false)
    expect(toolNeedsApproval('ignore', 'write_file')).toBe(false)
  })

  it('never asks for safe (non-dangerous) tools at any level', () => {
    for (const level of ['ask', 'auto_edits', 'planning', 'ignore'] as const) {
      expect(toolNeedsApproval(level, 'read_file')).toBe(false)
      expect(toolNeedsApproval(level, 'web_search')).toBe(false)
      expect(toolNeedsApproval(level, 'undo_last_write')).toBe(false)
    }
  })
})

describe('truncateToolOutput', () => {
  it('passes short / empty output through unchanged', () => {
    expect(truncateToolOutput('hello')).toBe('hello')
    expect(truncateToolOutput('')).toBe('')
  })

  it('passes output exactly at the limit through unchanged', () => {
    const s = 'x'.repeat(TOOL_OUTPUT_LIMIT)
    expect(truncateToolOutput(s)).toBe(s)
  })

  it('truncates over-limit output, keeping head + tail with a marker', () => {
    const s = 'A'.repeat(2000) + 'M'.repeat(2000) + 'Z'.repeat(2000) // 6000
    const out = truncateToolOutput(s)
    expect(out.length).toBeLessThan(s.length)
    expect(out).toContain('SYSTEM TRUNCATED')
    expect(out).toContain('6000 characters')
    expect(out.startsWith('A')).toBe(true)
    expect(out.endsWith('Z')).toBe(true)
  })
})
