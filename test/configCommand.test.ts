import { describe, it, expect } from 'vitest'
import { applyConfigCommand, coerceConfigValue, CONFIG_KEYS } from '../src/utils/configCommand'

describe('coerceConfigValue', () => {
  it('número valida limites', () => {
    expect(coerceConfigValue(CONFIG_KEYS.temperature, '0.3')).toEqual({ value: 0.3 })
    expect(coerceConfigValue(CONFIG_KEYS.temperature, '5').error).toMatch(/máximo/)
    expect(coerceConfigValue(CONFIG_KEYS.temperature, 'abc').error).toMatch(/inválido/)
  })
  it('boolean aceita on/off/sim/não', () => {
    expect(coerceConfigValue(CONFIG_KEYS.thinking, 'on')).toEqual({ value: true })
    expect(coerceConfigValue(CONFIG_KEYS.thinking, 'off')).toEqual({ value: false })
    expect(coerceConfigValue(CONFIG_KEYS.thinking, 'sim')).toEqual({ value: true })
    expect(coerceConfigValue(CONFIG_KEYS.thinking, 'talvez').error).toBeTruthy()
  })
  it('enum é case-insensitive e devolve o valor canônico', () => {
    expect(coerceConfigValue(CONFIG_KEYS.effort, 'HIGH')).toEqual({ value: 'high' })
    expect(coerceConfigValue(CONFIG_KEYS.permission, 'ignore')).toEqual({ value: 'ignore' })
    expect(coerceConfigValue(CONFIG_KEYS.language, 'fr').error).toMatch(/pt, en/)
  })
})

describe('applyConfigCommand', () => {
  it('aplica um par e mapeia para o campo real (sem mutar a entrada)', () => {
    const base = { temperature: 0.7 }
    const r = applyConfigCommand(base, 'temperature=0.2')
    expect(r.settings.temperature).toBe(0.2)
    expect(r.changes).toEqual(['temperature → 0.2'])
    expect(base.temperature).toBe(0.7) // intacto
  })
  it('aplica vários pares e usa o apelido→campo', () => {
    const r = applyConfigCommand({}, 'effort=high maxtokens=8000 safemode=on')
    expect(r.settings.reasoningEffort).toBe('high')
    expect(r.settings.maxTokens).toBe(8000)
    expect(r.settings.safeMode).toBe(true)
    expect(r.errors).toEqual([])
  })
  it('reporta chave desconhecida e valor inválido, aplicando os válidos', () => {
    const r = applyConfigCommand({}, 'temperature=0.1 foo=bar effort=ultra')
    expect(r.settings.temperature).toBe(0.1)
    expect(r.errors.some(e => /desconhecida/.test(e))).toBe(true)
    expect(r.errors.some(e => /effort/.test(e))).toBe(true)
  })
  it('arg vazio devolve a ajuda', () => {
    const r = applyConfigCommand({}, '')
    expect(r.changes).toEqual([])
    expect(r.errors[0]).toMatch(/uso/)
  })
  it('aceita aspas no valor', () => {
    const r = applyConfigCommand({}, 'language="en"')
    expect(r.settings.language).toBe('en')
  })
})
