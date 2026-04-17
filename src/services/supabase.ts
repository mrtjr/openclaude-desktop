// ─── Supabase client factory ──────────────────────────────────────
//
// Initialized lazily — if the build doesn't have a Supabase URL configured,
// the whole Accounts/Sync feature gracefully degrades to "not configured"
// in the UI (local-first continues to work 100%).
//
// Setup (for developers building their own):
//   1. Create a free Supabase project at https://supabase.com
//   2. Run the migration in `supabase/migrations/001_initial.sql`
//   3. Configure redirect URLs for Google OAuth (http://127.0.0.1:* loopback)
//   4. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY at build time
//
// See docs/ACCOUNTS.md for full setup.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined
const ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON_KEY)
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured in this build. ' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time.'
    )
  }
  if (!client) {
    client = createClient(URL!, ANON_KEY!, {
      auth: {
        // Electron persists session via localStorage — safe because
        // contextIsolation is enabled (no 3rd-party JS in renderer).
        persistSession: true,
        autoRefreshToken: true,
        // OAuth redirect uses loopback HTTP server in main process
        detectSessionInUrl: false,
      },
    })
  }
  return client
}
