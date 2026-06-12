import { describe, it, expect } from 'vitest'
import { isRiskyDesktopAction } from '../src/utils/desktopPolicy'

describe('isRiskyDesktopAction', () => {
  it('flags opening an app as always risky', () => {
    expect(isRiskyDesktopAction('computer_open_app', { app: 'notepad' })).toBe(true)
    expect(isRiskyDesktopAction('computer_open_app', {})).toBe(true)
  })

  it('flags Ctrl/Alt shortcuts and destructive keys', () => {
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '^s' })).toBe(true)     // Ctrl+S
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '^w' })).toBe(true)     // Ctrl+W
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '%{F4}' })).toBe(true)  // Alt+F4
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '{DELETE}' })).toBe(true)
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '{DEL}' })).toBe(true)
  })

  it('treats plain navigation/text keys as safe', () => {
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '{ENTER}' })).toBe(false)
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '{TAB}' })).toBe(false)
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '{ESC}' })).toBe(false)
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '{BACKSPACE}' })).toBe(false)
    expect(isRiskyDesktopAction('computer_press_keys', { keys: '+{TAB}' })).toBe(false) // Shift+Tab is safe
  })

  it('does not flag plain typing', () => {
    expect(isRiskyDesktopAction('computer_type_text', { text: 'rm -rf /' })).toBe(false)
  })

  it('returns false for unrelated tools and tolerates missing args', () => {
    expect(isRiskyDesktopAction('execute_command', { command: 'dir' })).toBe(false)
    expect(isRiskyDesktopAction('computer_press_keys', null)).toBe(false)
    expect(isRiskyDesktopAction('computer_press_keys', {})).toBe(false)
  })
})
