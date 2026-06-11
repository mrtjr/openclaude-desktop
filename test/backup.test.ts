import { describe, it, expect, beforeEach } from 'vitest'
import {
  collectLocalStorageBackup, buildBackup, parseBackup, applyLocalStorageBackup,
  BACKUP_APP_ID, BACKUP_VERSION,
} from '../src/utils/backup'

// Minimal in-memory Storage for the tests.
function makeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() { return map.size },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
  } as Storage
}

describe('collectLocalStorageBackup', () => {
  it('collects only app-owned keys (openclaude- / oc.)', () => {
    const s = makeStorage({
      'openclaude-settings': '{"a":1}',
      'oc.onboarded': '1',
      'some-other-app': 'nope',
      'random': 'x',
    })
    const out = collectLocalStorageBackup(s)
    expect(out).toEqual({ 'openclaude-settings': '{"a":1}', 'oc.onboarded': '1' })
  })
})

describe('buildBackup', () => {
  it('wraps localStorage + files in a stamped envelope', () => {
    const env = buildBackup({ 'openclaude-x': '1' }, { 'memory.json': { facts: [] } }, '2026-06-11T00:00:00Z')
    expect(env.app).toBe(BACKUP_APP_ID)
    expect(env.version).toBe(BACKUP_VERSION)
    expect(env.exportedAt).toBe('2026-06-11T00:00:00Z')
    expect(env.localStorage).toEqual({ 'openclaude-x': '1' })
    expect(env.files['memory.json']).toEqual({ facts: [] })
  })
})

describe('parseBackup', () => {
  it('round-trips a valid envelope', () => {
    const json = JSON.stringify(buildBackup({ 'oc.onboarded': '1' }, { 'conversations.json': [] }, 'now'))
    const parsed = parseBackup(json)
    expect(parsed.localStorage).toEqual({ 'oc.onboarded': '1' })
    expect(parsed.files['conversations.json']).toEqual([])
  })

  it('rejects non-JSON, foreign files, and version-less data', () => {
    expect(() => parseBackup('not json')).toThrow(/JSON/)
    expect(() => parseBackup(JSON.stringify({ app: 'something-else' }))).toThrow(/OpenClaude/)
    expect(() => parseBackup(JSON.stringify({ app: BACKUP_APP_ID }))).toThrow(/versão/)
  })

  it('tolerates missing localStorage/files sections', () => {
    const parsed = parseBackup(JSON.stringify({ app: BACKUP_APP_ID, version: 1 }))
    expect(parsed.localStorage).toEqual({})
    expect(parsed.files).toEqual({})
  })
})

describe('applyLocalStorageBackup', () => {
  let s: Storage
  beforeEach(() => { s = makeStorage() })

  it('writes app keys and ignores foreign/non-string ones', () => {
    const n = applyLocalStorageBackup(s, { 'openclaude-settings': '{"a":1}', 'evil': 'x', 'oc.x': 5 as any })
    expect(n).toBe(1)
    expect(s.getItem('openclaude-settings')).toBe('{"a":1}')
    expect(s.getItem('evil')).toBeNull()
    expect(s.getItem('oc.x')).toBeNull()
  })

  it('is the inverse of collect for app keys', () => {
    const src = makeStorage({ 'openclaude-a': '1', 'oc.b': '2', 'foreign': 'z' })
    const dest = makeStorage()
    applyLocalStorageBackup(dest, collectLocalStorageBackup(src))
    expect(dest.getItem('openclaude-a')).toBe('1')
    expect(dest.getItem('oc.b')).toBe('2')
    expect(dest.getItem('foreign')).toBeNull()
  })
})
