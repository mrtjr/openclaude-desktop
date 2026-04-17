// ─── Auth service ─────────────────────────────────────────────────
// Thin wrapper around Supabase Auth with email+password and Google OAuth
// via Electron loopback PKCE flow.

import { getSupabase, isSupabaseConfigured } from './supabase'
import type { AuthSession, AuthUser } from '../types/account'

function mapSession(s: any): AuthSession | null {
  if (!s?.user || !s?.access_token) return null
  return {
    user: {
      id: s.user.id,
      email: s.user.email ?? '',
      provider: s.user.app_metadata?.provider === 'google' ? 'google' : 'email',
      createdAt: s.user.created_at ?? new Date().toISOString(),
    },
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: (s.expires_at ?? 0) * 1000,
  }
}

// ── Email + password ──────────────────────────────────────────────────

export async function signUpWithEmail(email: string, password: string): Promise<AuthSession> {
  const sb = getSupabase()
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) throw error
  // Supabase may require email confirmation — session null until confirmed.
  const session = mapSession(data.session)
  if (!session) {
    throw new Error('Confirme seu email para ativar a conta.')
  }
  return session
}

export async function signInWithEmail(email: string, password: string): Promise<AuthSession> {
  const sb = getSupabase()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
  const session = mapSession(data.session)
  if (!session) throw new Error('Login falhou — sessão inválida')
  return session
}

// ── Google OAuth (Electron loopback PKCE) ─────────────────────────────
//
// Flow (implemented in electron/oauth-loopback.js):
//   1. Main process starts a loopback HTTP server on an ephemeral port
//   2. Builds Supabase OAuth URL with redirect = http://127.0.0.1:<port>/callback
//   3. Opens system browser via shell.openExternal
//   4. Google redirects → loopback → main captures `code` + `state`
//   5. Exchanges code for Supabase session via `exchangeCodeForSession`
//   6. Returns session to renderer via IPC

export async function signInWithGoogle(): Promise<AuthSession> {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured')
  const electron = (window as any).electron
  if (!electron?.oauthGoogleStart) {
    throw new Error('OAuth não disponível neste build (renderer standalone)')
  }
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string
  const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string
  const result = await electron.oauthGoogleStart({ supabaseUrl, anonKey })
  if (result?.error) throw new Error(result.error)
  if (!result?.session) throw new Error('OAuth cancelado')
  // Persist session into Supabase client so subsequent calls use it
  const sb = getSupabase()
  await sb.auth.setSession({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
  })
  const mapped = mapSession(result.session)
  if (!mapped) throw new Error('Sessão OAuth inválida')
  return mapped
}

// ── Session lifecycle ─────────────────────────────────────────────────

export async function getCurrentSession(): Promise<AuthSession | null> {
  if (!isSupabaseConfigured()) return null
  const sb = getSupabase()
  const { data } = await sb.auth.getSession()
  return mapSession(data.session)
}

export async function signOut(): Promise<void> {
  const sb = getSupabase()
  await sb.auth.signOut()
}

export async function sendPasswordReset(email: string): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.auth.resetPasswordForEmail(email)
  if (error) throw error
}

/** Subscribe to auth state changes — returns unsubscribe fn. */
export function onAuthStateChange(
  handler: (session: AuthSession | null) => void,
): () => void {
  if (!isSupabaseConfigured()) return () => {}
  const sb = getSupabase()
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    handler(mapSession(session))
  })
  return () => data.subscription.unsubscribe()
}

/** Expose the current user (sync, assumes session was already fetched). */
export function getCurrentUser(): AuthUser | null {
  if (!isSupabaseConfigured()) return null
  const sb = getSupabase()
  const u = sb.auth.getUser
  // Synchronous access via internal state (safe-guarded)
  const session = (sb.auth as any).session?.()
  if (!session?.user) return null
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    provider: session.user.app_metadata?.provider === 'google' ? 'google' : 'email',
    createdAt: session.user.created_at ?? new Date().toISOString(),
  }
}

void mapSession  // silence ts unused if tree-shaken
