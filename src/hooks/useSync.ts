// ─── useSync — orchestrates cloud sync for a logged-in user ──────
//
// The hook owns:
//   - sync preferences (persisted to localStorage)
//   - status (idle/syncing/error/offline/conflict)
//   - push/pull actions
//
// It deliberately stays "dumb" about what to sync — the caller passes
// a `snapshotProvider` that returns the current local state, and an
// `applySnapshot` that merges pulled data back. This keeps the hook
// decoupled from the rest of the app.

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AuthSession,
  SyncPreferences,
  SyncState,
} from '../types/account'
import { DEFAULT_SYNC_PREFS } from '../types/account'
import { pullAll, pushAll, type SyncItem, type SyncKind } from '../services/sync'

const PREFS_KEY = 'openclaude-sync-prefs'

export type SyncSnapshot = Partial<Record<SyncKind, any>>

export interface UseSyncOptions {
  session: AuthSession | null
  passphrase: string | undefined
  /** Called when sync wants the current local state to push. */
  snapshotProvider: () => SyncSnapshot
  /** Called with server data after a successful pull. */
  applySnapshot: (snapshot: Partial<Record<SyncKind, SyncItem>>) => void
  /** Push debounce (ms) when autoPush is enabled. */
  autoPushDebounceMs?: number
}

export interface UseSyncResult {
  prefs: SyncPreferences
  setPrefs: (p: SyncPreferences) => void
  state: SyncState
  pushNow: () => Promise<void>
  pullNow: () => Promise<void>
  /** Mark that local state changed and a push should happen soon. */
  markDirty: () => void
}

function loadPrefs(): SyncPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { ...DEFAULT_SYNC_PREFS, ...JSON.parse(raw) }
  } catch {}
  return DEFAULT_SYNC_PREFS
}

function savePrefs(p: SyncPreferences) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch {}
}

export function useSync(opts: UseSyncOptions): UseSyncResult {
  const { session, passphrase, snapshotProvider, applySnapshot, autoPushDebounceMs = 3000 } = opts
  const [prefs, _setPrefs] = useState<SyncPreferences>(() => loadPrefs())
  const [state, setState] = useState<SyncState>({ status: 'idle', pendingChanges: 0 })
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(0)

  const setPrefs = useCallback((p: SyncPreferences) => {
    _setPrefs(p)
    savePrefs(p)
  }, [])

  const pushNow = useCallback(async () => {
    if (!session) return
    if (!prefs.enabled) return
    setState((s) => ({ ...s, status: 'syncing' }))
    try {
      const snapshot = snapshotProvider()
      const { errors } = await pushAll(session.user.id, prefs, snapshot, passphrase)
      pendingRef.current = 0
      setState({
        status: errors.length ? 'error' : 'idle',
        lastSyncAt: Date.now(),
        lastError: errors.length ? errors.map((e) => `${e.kind}: ${e.error}`).join('; ') : undefined,
        pendingChanges: 0,
      })
    } catch (e: any) {
      setState((s) => ({ ...s, status: 'error', lastError: e.message || String(e) }))
    }
  }, [session, prefs, passphrase, snapshotProvider])

  const pullNow = useCallback(async () => {
    if (!session) return
    if (!prefs.enabled) return
    setState((s) => ({ ...s, status: 'syncing' }))
    try {
      const { snapshot, errors } = await pullAll(session.user.id, prefs, passphrase)
      applySnapshot(snapshot)
      setState({
        status: errors.length ? 'error' : 'idle',
        lastSyncAt: Date.now(),
        lastError: errors.length ? errors.map((e) => `${e.kind}: ${e.error}`).join('; ') : undefined,
        pendingChanges: pendingRef.current,
      })
    } catch (e: any) {
      setState((s) => ({ ...s, status: 'error', lastError: e.message || String(e) }))
    }
  }, [session, prefs, passphrase, applySnapshot])

  const markDirty = useCallback(() => {
    pendingRef.current += 1
    setState((s) => ({ ...s, pendingChanges: pendingRef.current }))
    if (!session || !prefs.enabled) return
    if (pushTimer.current) clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(() => { void pushNow() }, autoPushDebounceMs)
  }, [session, prefs.enabled, autoPushDebounceMs, pushNow])

  // Pull on sign-in (one-shot, doesn't re-fire on every render)
  const pulledForUser = useRef<string | null>(null)
  useEffect(() => {
    if (!session) { pulledForUser.current = null; return }
    if (!prefs.enabled) return
    if (pulledForUser.current === session.user.id) return
    // If any encrypted kind is enabled, we need the passphrase first.
    const needsPp = prefs.syncKeys
    if (needsPp && !passphrase) return
    pulledForUser.current = session.user.id
    void pullNow()
  }, [session, prefs.enabled, prefs.syncKeys, passphrase, pullNow])

  // Cleanup debounce on unmount
  useEffect(() => () => { if (pushTimer.current) clearTimeout(pushTimer.current) }, [])

  return { prefs, setPrefs, state, pushNow, pullNow, markDirty }
}
