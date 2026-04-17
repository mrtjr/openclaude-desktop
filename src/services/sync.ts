// ─── Cloud Sync service ───────────────────────────────────────────
//
// Data model: a single `sync_items` table in Supabase with RLS,
// keyed by (user_id, kind). Payload is JSONB.
//
//   - "settings" / "profiles" / "personas" / "scheduledTasks" ...
//     → stored as plain JSON (not secret). Contains user prefs only.
//   - "apiKeys" / "canary"
//     → stored as an EncryptedBlob (client-side E2EE via passphrase).
//
// Conflict resolution: Last-Write-Wins based on `updated_at`. The local
// client stamps its own `updated_at`; on pull, if server is newer, local
// is replaced. A future iteration can do per-field merging.
//
// Zero-knowledge: API keys and any "secret" blobs are encrypted with the
// user's passphrase BEFORE hitting the network. Supabase sees only ciphertext.

import { getSupabase, isSupabaseConfigured } from './supabase'
import { encryptString, decryptString } from './crypto'
import type { EncryptedBlob, SyncPreferences } from '../types/account'

export type SyncKind =
  | 'settings'
  | 'profiles'
  | 'personas'
  | 'scheduledTasks'
  | 'apiKeys'      // encrypted
  | 'canary'       // encrypted

export interface SyncItem<T = any> {
  kind: SyncKind
  data: T
  updatedAt: number
}

const ENCRYPTED_KINDS: SyncKind[] = ['apiKeys', 'canary']

export function isEncryptedKind(kind: SyncKind): boolean {
  return ENCRYPTED_KINDS.includes(kind)
}

/** Push one item to the server. If encrypted, requires passphrase. */
export async function pushItem<T>(
  userId: string,
  kind: SyncKind,
  data: T,
  passphrase?: string,
): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured')
  const sb = getSupabase()

  let payload: any
  if (isEncryptedKind(kind)) {
    if (!passphrase) throw new Error(`Passphrase required to sync "${kind}"`)
    const plaintext = JSON.stringify(data)
    const blob: EncryptedBlob = await encryptString(plaintext, passphrase)
    payload = { encrypted: true, blob }
  } else {
    payload = { encrypted: false, data }
  }

  const { error } = await sb
    .from('sync_items')
    .upsert(
      {
        user_id: userId,
        kind,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,kind' },
    )
  if (error) throw error
}

/** Pull one item from the server. Returns null if not present. */
export async function pullItem<T = any>(
  userId: string,
  kind: SyncKind,
  passphrase?: string,
): Promise<SyncItem<T> | null> {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured')
  const sb = getSupabase()

  const { data, error } = await sb
    .from('sync_items')
    .select('kind, payload, updated_at')
    .eq('user_id', userId)
    .eq('kind', kind)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const payload = data.payload as any
  let value: T
  if (payload?.encrypted) {
    if (!passphrase) throw new Error(`Passphrase required to decrypt "${kind}"`)
    const pt = await decryptString(payload.blob as EncryptedBlob, passphrase)
    value = JSON.parse(pt) as T
  } else {
    value = payload?.data as T
  }
  return {
    kind,
    data: value,
    updatedAt: new Date(data.updated_at).getTime(),
  }
}

/** Delete an item (used when user disables a sync category). */
export async function deleteItem(userId: string, kind: SyncKind): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured')
  const sb = getSupabase()
  const { error } = await sb.from('sync_items').delete().eq('user_id', userId).eq('kind', kind)
  if (error) throw error
}

/**
 * Run a full push cycle based on the user's sync preferences.
 * `snapshot` is a map of local values keyed by SyncKind (caller assembles it).
 */
export async function pushAll(
  userId: string,
  prefs: SyncPreferences,
  snapshot: Partial<Record<SyncKind, any>>,
  passphrase?: string,
): Promise<{ pushed: SyncKind[]; errors: Array<{ kind: SyncKind; error: string }> }> {
  const pushed: SyncKind[] = []
  const errors: Array<{ kind: SyncKind; error: string }> = []
  const kinds: SyncKind[] = []

  if (prefs.syncSettings && snapshot.settings !== undefined) kinds.push('settings')
  if (prefs.syncProfiles && snapshot.profiles !== undefined) kinds.push('profiles')
  if (prefs.syncPersonas && snapshot.personas !== undefined) kinds.push('personas')
  if (prefs.syncScheduledTasks && snapshot.scheduledTasks !== undefined) kinds.push('scheduledTasks')
  if (prefs.syncKeys && snapshot.apiKeys !== undefined) kinds.push('apiKeys')

  for (const kind of kinds) {
    try {
      await pushItem(userId, kind, snapshot[kind], passphrase)
      pushed.push(kind)
    } catch (e: any) {
      errors.push({ kind, error: e.message || String(e) })
    }
  }
  return { pushed, errors }
}

/**
 * Pull everything the user has on the server.
 * Returns a partial snapshot; caller merges into local state.
 */
export async function pullAll(
  userId: string,
  prefs: SyncPreferences,
  passphrase?: string,
): Promise<{
  snapshot: Partial<Record<SyncKind, SyncItem>>
  errors: Array<{ kind: SyncKind; error: string }>
}> {
  const snapshot: Partial<Record<SyncKind, SyncItem>> = {}
  const errors: Array<{ kind: SyncKind; error: string }> = []
  const kinds: SyncKind[] = []

  if (prefs.syncSettings) kinds.push('settings')
  if (prefs.syncProfiles) kinds.push('profiles')
  if (prefs.syncPersonas) kinds.push('personas')
  if (prefs.syncScheduledTasks) kinds.push('scheduledTasks')
  if (prefs.syncKeys) kinds.push('apiKeys')

  for (const kind of kinds) {
    try {
      const item = await pullItem(userId, kind, passphrase)
      if (item) snapshot[kind] = item
    } catch (e: any) {
      errors.push({ kind, error: e.message || String(e) })
    }
  }
  return { snapshot, errors }
}
