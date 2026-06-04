// ─── useAuth — session lifecycle + passphrase (in-memory) ─────────
//
// Session source-of-truth is Supabase's own client (persists to localStorage).
// Passphrase is kept in-memory ONLY — never persisted. Lost passphrase ⇒ the
// user must re-enter it on next app start (and we can't decrypt their keys
// until they do). This is the zero-knowledge contract.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSession } from '../types/account'
import {
  getCurrentSession,
  onAuthStateChange,
  signInWithEmail as _signInEmail,
  signUpWithEmail as _signUpEmail,
  signInWithGoogle as _signInGoogle,
  signOut as _signOut,
} from '../services/auth'
import { isSupabaseConfigured } from '../services/supabase'

export interface UseAuthResult {
  configured: boolean
  session: AuthSession | null
  loading: boolean
  /** Passphrase for E2EE — in-memory only. undefined = user hasn't unlocked yet. */
  passphrase: string | undefined
  setPassphrase: (p: string | undefined) => void
  signInEmail: (email: string, password: string) => Promise<void>
  signUpEmail: (email: string, password: string) => Promise<void>
  signInGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export function useAuth(): UseAuthResult {
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState<boolean>(configured)
  const [passphrase, _setPassphrase] = useState<string | undefined>(undefined)
  const ppRef = useRef<string | undefined>(undefined)

  const setPassphrase = useCallback((p: string | undefined) => {
    ppRef.current = p
    _setPassphrase(p)
  }, [])

  useEffect(() => {
    if (!configured) { setLoading(false); return }
    let mounted = true
    ;(async () => {
      try {
        const s = await getCurrentSession()
        if (mounted) setSession(s)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    let lastUserId: string | null = null
    const unsub = onAuthStateChange((s) => {
      if (!mounted) return
      const newUserId = s?.user?.id ?? null
      // Clear passphrase on sign-out OR identity change — it's tied to a
      // specific account. Without the identity check, switching from
      // account A to B (e.g., Google OAuth replaying with a different user)
      // would keep A's passphrase in memory, and crypto ops on B's
      // encrypted blobs would throw what looks like corruption errors.
      if (!s || (lastUserId && newUserId && newUserId !== lastUserId)) {
        setPassphrase(undefined)
      }
      lastUserId = newUserId
      setSession(s)
    })
    return () => { mounted = false; unsub() }
  }, [configured, setPassphrase])

  const signInEmail = useCallback(async (email: string, password: string) => {
    const s = await _signInEmail(email, password)
    setSession(s)
  }, [])

  const signUpEmail = useCallback(async (email: string, password: string) => {
    const s = await _signUpEmail(email, password)
    setSession(s)
  }, [])

  const signInGoogle = useCallback(async () => {
    const s = await _signInGoogle()
    setSession(s)
  }, [])

  const signOut = useCallback(async () => {
    await _signOut()
    setSession(null)
    setPassphrase(undefined)
  }, [setPassphrase])

  return {
    configured,
    session,
    loading,
    passphrase,
    setPassphrase,
    signInEmail,
    signUpEmail,
    signInGoogle,
    signOut,
  }
}
