// ─── E2EE Crypto (WebCrypto API, zero native deps) ────────────────
//
// Design:
//   - User chooses a passphrase (separate from account password).
//   - Passphrase + random salt → PBKDF2-SHA256 (600k iters, OWASP 2023) → AES-256 key.
//   - Plaintext encrypted with AES-GCM (authenticated encryption).
//   - Ciphertext + salt + iterations uploaded; passphrase NEVER leaves the device.
//
// Security notes:
//   - Argon2 would be stronger but requires a WASM dep (argon2-browser ~200KB)
//     and WebCrypto subtleCrypto does not expose it. PBKDF2 with 600k iters is
//     OWASP's current recommendation for PBKDF2-SHA256 — acceptable baseline.
//   - Each encrypted blob uses its own random IV (GCM must never reuse).
//   - Salt is per-blob (not per-user) so passphrase rotation re-encrypts cleanly.
//
// References:
//   - OWASP Password Storage Cheat Sheet (PBKDF2-SHA256, 600k iters)
//   - Bitwarden whitepaper — similar architecture
//   - https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto

import type { EncryptedBlob } from '../types/account'

export const PBKDF2_ITERATIONS = 600_000
export const SALT_BYTES = 16
export const IV_BYTES = 12  // GCM standard IV length

// ── Base64 helpers (browser-friendly) ────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── Key derivation ───────────────────────────────────────────────────

/**
 * Derive an AES-256 key from a user passphrase via PBKDF2-SHA256.
 * This is the slow step (~500ms on a modern CPU at 600k iters) — cache the
 * derived key in memory for the session.
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,  // not extractable
    ['encrypt', 'decrypt'],
  )
}

// ── Encrypt / Decrypt ────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with a passphrase.
 * Returns an EncryptedBlob suitable for uploading to the server.
 */
export async function encryptString(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const enc = new TextEncoder()
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)),
  )
  // Pack iv + ct together (GCM auth tag is appended to ct by the API)
  const packed = new Uint8Array(iv.length + ct.length)
  packed.set(iv, 0)
  packed.set(ct, iv.length)
  return {
    ciphertext: bytesToBase64(packed),
    salt: bytesToBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2-sha256',
    version: 1,
  }
}

/**
 * Decrypt a blob previously produced by encryptString.
 * Throws on auth failure (wrong passphrase or tampered ciphertext).
 */
export async function decryptString(
  blob: EncryptedBlob,
  passphrase: string,
): Promise<string> {
  if (blob.version !== 1) throw new Error(`Unsupported blob version: ${blob.version}`)
  if (blob.algorithm !== 'aes-256-gcm') throw new Error(`Unsupported algorithm: ${blob.algorithm}`)

  const salt = base64ToBytes(blob.salt)
  const packed = base64ToBytes(blob.ciphertext)
  const iv = packed.slice(0, IV_BYTES)
  const ct = packed.slice(IV_BYTES)
  const key = await deriveKey(passphrase, salt, blob.iterations)

  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  } catch (e) {
    // GCM auth tag mismatch → wrong passphrase OR tampered data
    throw new Error('Decryption failed: wrong passphrase or corrupted data')
  }
}

// ── Passphrase verification (cheap round-trip) ───────────────────────

/**
 * Used at login to verify the user's passphrase matches what was used to
 * encrypt their blobs. Encrypts a known canary and checks it decrypts.
 *
 * Caller stores the canary blob on the server; on login, fetch it and call
 * this with user-entered passphrase. `true` ⇒ passphrase is correct.
 */
export async function verifyPassphrase(
  passphrase: string,
  canaryBlob: EncryptedBlob,
  expectedPlaintext: string,
): Promise<boolean> {
  try {
    const pt = await decryptString(canaryBlob, passphrase)
    return pt === expectedPlaintext
  } catch {
    return false
  }
}

/** Create a canary blob for new users — store this on the server. */
export async function createCanary(passphrase: string): Promise<{
  blob: EncryptedBlob
  expectedPlaintext: string
}> {
  const expectedPlaintext = `openclaude-canary-${Date.now()}`
  const blob = await encryptString(expectedPlaintext, passphrase)
  return { blob, expectedPlaintext }
}

// ── Password strength heuristic (for UX hints) ───────────────────────

export function passphraseStrength(p: string): 'weak' | 'medium' | 'strong' {
  if (p.length < 10) return 'weak'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(r => r.test(p)).length
  if (p.length >= 16 && classes >= 3) return 'strong'
  if (p.length >= 12 && classes >= 2) return 'medium'
  return 'weak'
}
