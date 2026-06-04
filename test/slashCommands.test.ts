import { describe, it, expect } from 'vitest'
import { parseSlashInput, SLASH_COMMANDS } from '../src/utils/slashCommands'

describe('parseSlashInput', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashInput('')).toBeNull()
    expect(parseSlashInput('hello')).toBeNull()
    expect(parseSlashInput(' /clear')).toBeNull() // leading space = not a command
  })

  it('returns null for the escape sequence "//" (literal slash send)', () => {
    expect(parseSlashInput('//clear')).toBeNull()
    expect(parseSlashInput('//')).toBeNull()
  })

  it('parses a complete command name with no argument', () => {
    const parsed = parseSlashInput('/clear')
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe('clear')
    expect(parsed!.arg).toBe('')
    expect(parsed!.matches.map(m => m.name)).toContain('clear')
  })

  it('is case-insensitive on the command name', () => {
    expect(parseSlashInput('/CLEAR')!.name).toBe('clear')
    expect(parseSlashInput('/Model')!.name).toBe('model')
  })

  it('preserves argument case (system prompts are case-sensitive)', () => {
    const parsed = parseSlashInput('/system You Are A Pirate')
    expect(parsed!.arg).toBe('You Are A Pirate')
  })

  it('captures everything after the first space as the argument', () => {
    const parsed = parseSlashInput('/model llama3.1 with extra words')
    expect(parsed!.name).toBe('model')
    expect(parsed!.arg).toBe('llama3.1 with extra words')
  })

  it('returns all commands matching a prefix', () => {
    // "/" alone matches everything.
    const all = parseSlashInput('/')
    expect(all!.matches.length).toBe(SLASH_COMMANDS.length)
    // Prefix "c" matches "clear", "compact", "context".
    const clearOnly = parseSlashInput('/c')
    expect(clearOnly!.matches.map(m => m.name).sort()).toEqual(['clear', 'compact', 'context'])
    // Prefix "m" only matches "model".
    const modelOnly = parseSlashInput('/m')
    expect(modelOnly!.matches.map(m => m.name)).toEqual(['model'])
  })

  it('returns empty matches when the prefix matches nothing', () => {
    const parsed = parseSlashInput('/zzz')
    expect(parsed).not.toBeNull()
    expect(parsed!.matches).toEqual([])
  })

  it('handles trailing space as "name complete, args empty"', () => {
    const parsed = parseSlashInput('/model ')
    expect(parsed!.name).toBe('model')
    expect(parsed!.arg).toBe('')
  })
})

describe('SLASH_COMMANDS registry', () => {
  it('has a stable set of command names exposed to the UI', () => {
    const names = SLASH_COMMANDS.map(c => c.name).sort()
    expect(names).toEqual(['clear', 'compact', 'context', 'model', 'regen', 'system', 'theme'])
  })

  it('each command declares a description (PT at minimum)', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.description).toBeTruthy()
      expect(typeof cmd.description).toBe('string')
    }
  })

  it('command names are lowercase and contain no spaces', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name).toBe(cmd.name.toLowerCase())
      expect(cmd.name).not.toMatch(/\s/)
    }
  })
})
