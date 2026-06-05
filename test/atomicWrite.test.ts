// ─── Atomic write helper tests ──────────────────────────────────────
//
// Exercises electron/atomic-write.js against the real filesystem in a temp
// dir. This is the durable core of the v2.12.15 data-safety fix — the main
// process can't be unit-tested directly, but the write/rotate/recover logic
// it now relies on can.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { atomicWriteJSON, readJSONWithFallback } from '../electron/atomic-write.js'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-atomic-'))
  file = path.join(dir, 'store.json')
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
})

describe('atomicWriteJSON / readJSONWithFallback', () => {
  it('round-trips data', () => {
    atomicWriteJSON(file, { a: 1, b: [2, 3] })
    expect(readJSONWithFallback(file, null)).toEqual({ a: 1, b: [2, 3] })
  })

  it('returns the fallback when nothing has been written', () => {
    expect(readJSONWithFallback(file, [])).toEqual([])
  })

  it('leaves no .tmp behind and writes no .bak on the first write', () => {
    atomicWriteJSON(file, { v: 1 })
    expect(fs.existsSync(file + '.tmp')).toBe(false)
    expect(fs.existsSync(file + '.bak')).toBe(false)
  })

  it('rotates the previous version into .bak on overwrite', () => {
    atomicWriteJSON(file, { v: 1 })
    atomicWriteJSON(file, { v: 2 })
    expect(readJSONWithFallback(file, null)).toEqual({ v: 2 })
    expect(JSON.parse(fs.readFileSync(file + '.bak', 'utf-8'))).toEqual({ v: 1 })
  })

  it('recovers the previous version from .bak when the primary is corrupt', () => {
    atomicWriteJSON(file, { v: 1 })
    atomicWriteJSON(file, { v: 2 })                 // .bak={v:1}, file={v:2}
    fs.writeFileSync(file, '{ truncated', 'utf-8')  // simulate a torn write
    expect(readJSONWithFallback(file, null)).toEqual({ v: 1 })
  })

  it('honors compact (pretty=false) vs pretty output', () => {
    atomicWriteJSON(file, { a: 1 }, false)
    expect(fs.readFileSync(file, 'utf-8')).toBe('{"a":1}')
    atomicWriteJSON(file, { a: 1 }, true)
    expect(fs.readFileSync(file, 'utf-8')).toContain('\n') // pretty has newlines
  })
})
