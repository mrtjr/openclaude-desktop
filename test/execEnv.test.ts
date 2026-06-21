import { describe, it, expect } from 'vitest'
// @ts-ignore — CJS helper
import { sanitizeChildEnv, BLOCKED_ENV_KEYS } from '../electron/exec-env.js'

describe('sanitizeChildEnv', () => {
  it('mantém chaves seguras (ex.: hooks OPENCLAUDE_*)', () => {
    expect(sanitizeChildEnv({ OPENCLAUDE_TOOL_NAME: 'write_file', OPENCLAUDE_TOOL_ARGS: '{"a":1}' }))
      .toEqual({ OPENCLAUDE_TOOL_NAME: 'write_file', OPENCLAUDE_TOOL_ARGS: '{"a":1}' })
  })
  it('barra chaves de hijack de processo (case-insensitive)', () => {
    const out = sanitizeChildEnv({ PATH: '/evil/bin', node_options: '--require x', X: 'ok', LD_PRELOAD: '/e.so', PSModulePath: 'C:\\evil' })
    expect(out).toEqual({ X: 'ok' })
  })
  it('barra chaves com formato inválido', () => {
    expect(sanitizeChildEnv({ 'a b': '1', '1abc': '2', 'a-b': '3', OK_KEY: '4' })).toEqual({ OK_KEY: '4' })
  })
  it('coage valor a string e limita o tamanho', () => {
    const out = sanitizeChildEnv({ N: 42 as any, BIG: 'x'.repeat(20000) }) as Record<string, string>
    expect(out.N).toBe('42')
    expect(out.BIG.length).toBe(16384)
  })
  it('entrada inválida / vazia → null', () => {
    expect(sanitizeChildEnv(undefined as any)).toBeNull()
    expect(sanitizeChildEnv([] as any)).toBeNull()
    expect(sanitizeChildEnv({ PATH: 'x' })).toBeNull() // só hijack → nada sobra
  })
  it('a denylist cobre os principais vetores', () => {
    for (const k of ['path', 'node_options', 'ld_preload', 'dyld_insert_libraries', 'psmodulepath', 'electron_run_as_node']) {
      expect(BLOCKED_ENV_KEYS.has(k)).toBe(true)
    }
  })
})
