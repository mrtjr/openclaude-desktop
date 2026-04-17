// ─── E2EE crypto round-trip tests ─────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  encryptString, decryptString, verifyPassphrase, createCanary, passphraseStrength,
} from '../src/services/crypto'

// Speed up tests — 600k PBKDF2 iters × several tests is ~3s; still acceptable.

describe('crypto service', () => {
  it('round-trips a simple string', async () => {
    const blob = await encryptString('hello world', 'correct horse battery staple')
    const pt = await decryptString(blob, 'correct horse battery staple')
    expect(pt).toBe('hello world')
  })

  it('fails to decrypt with wrong passphrase', async () => {
    const blob = await encryptString('secret', 'right-passphrase-123')
    await expect(decryptString(blob, 'wrong-passphrase-123')).rejects.toThrow()
  })

  it('produces different ciphertext for the same plaintext (fresh IV+salt)', async () => {
    const a = await encryptString('x', 'p')
    const b = await encryptString('x', 'p')
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.salt).not.toBe(b.salt)
  })

  it('verifyPassphrase accepts correct + rejects wrong', async () => {
    const { blob, expectedPlaintext } = await createCanary('my-pass-2024')
    expect(await verifyPassphrase('my-pass-2024', blob, expectedPlaintext)).toBe(true)
    expect(await verifyPassphrase('nope', blob, expectedPlaintext)).toBe(false)
  })

  it('rejects unknown blob version', async () => {
    const blob = await encryptString('x', 'p')
    await expect(decryptString({ ...blob, version: 2 as any }, 'p')).rejects.toThrow(/version/i)
  })

  it('rates passphrase strength', () => {
    expect(passphraseStrength('short')).toBe('weak')
    expect(passphraseStrength('abcdefghijkl')).toBe('weak')   // only 1 char class
    expect(passphraseStrength('abcdefghij12')).toBe('medium') // 2 classes, >= 12
    expect(passphraseStrength('Abcdefghij12!@#$')).toBe('strong')
  })
})
