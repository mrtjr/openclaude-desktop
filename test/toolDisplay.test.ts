import { describe, it, expect } from 'vitest'
import { toolCallSummary } from '../src/utils/toolDisplay'

describe('toolCallSummary', () => {
  it('picks the primary argument per tool shape', () => {
    expect(toolCallSummary('execute_command', { command: 'npm test' })).toBe('npm test')
    expect(toolCallSummary('browser_navigate', { url: 'https://exemplo.com/x' })).toBe('https://exemplo.com/x')
    expect(toolCallSummary('read_file', { path: 'C:/robos/ea.mq5' })).toBe('C:/robos/ea.mq5')
    expect(toolCallSummary('web_search', { query: 'preço do dólar hoje' })).toBe('preço do dólar hoje')
  })

  it('prefers command over other keys when several exist', () => {
    expect(toolCallSummary('execute_command', { command: 'dir', cwd: 'D:/x' })).toBe('dir')
  })

  it('collapses multiline commands to one line', () => {
    expect(toolCallSummary('execute_command', { command: 'git add .\n  git commit' })).toBe('git add . git commit')
  })

  it('truncates long values with an ellipsis at the max', () => {
    const out = toolCallSummary('execute_command', { command: 'x'.repeat(100) }, 60)
    expect(out.length).toBe(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns empty string when there is nothing presentable', () => {
    expect(toolCallSummary('plan_tasks', {})).toBe('')
    expect(toolCallSummary('x', null)).toBe('')
    expect(toolCallSummary('x', { command: '   ' })).toBe('')
    expect(toolCallSummary('x', { command: 123 as unknown as string })).toBe('')
  })
})
