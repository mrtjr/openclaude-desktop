// ─── Account + Sync types ─────────────────────────────────────────
// Shared types for auth, passphrase-derived E2EE, and cloud sync.

export interface AuthUser {
  id: string              // Supabase user.id (UUID)
  email: string
  provider: 'email' | 'google'
  createdAt: string       // ISO
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
  refreshToken: string
  expiresAt: number       // epoch ms
}

/**
 * Encrypted blob format for secrets stored on the server.
 * Ciphertext is base64. Everything needed to decrypt lives alongside,
 * except the passphrase itself (zero-knowledge).
 */
export interface EncryptedBlob {
  ciphertext: string      // base64(iv || encrypted || authTag)  — WebCrypto AES-GCM
  salt: string            // base64, random per-blob (allows passphrase rotation)
  iterations: number      // PBKDF2 iterations used for key derivation
  algorithm: 'aes-256-gcm'
  kdf: 'pbkdf2-sha256'
  version: 1              // schema version for forward compat
}

/** Sync preferences — user decides what leaves the device. */
export interface SyncPreferences {
  enabled: boolean
  syncSettings: boolean         // theme, language, provider choice, etc.
  syncKeys: boolean             // API keys — requires passphrase (E2EE)
  syncProfiles: boolean         // Agent profiles (incl. prompts)
  syncScheduledTasks: boolean
  syncPersonas: boolean
  syncConversations: boolean    // off by default (volume + privacy)
  syncAgentMemory: boolean      // off by default
}

export const DEFAULT_SYNC_PREFS: SyncPreferences = {
  enabled: true,
  syncSettings: true,
  syncKeys: true,
  syncProfiles: true,
  syncScheduledTasks: true,
  syncPersonas: true,
  syncConversations: false,
  syncAgentMemory: false,
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'conflict'

export interface SyncState {
  status: SyncStatus
  lastSyncAt?: number
  lastError?: string
  pendingChanges: number
}
