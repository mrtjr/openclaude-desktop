// ─── Supabase client factory ──────────────────────────────────────
//
// Credentials resolution order (first non-empty wins):
//   1. localStorage `oc.supabaseUrl` / `oc.supabaseAnonKey` — set at runtime
//      via the Account panel's setup form. Lets end-users enable cloud sync
//      without rebuilding the app.
//   2. Build-time env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
//
// If neither source has values, `isSupabaseConfigured()` returns false and
// the Account panel shows its inline setup form. Local-first usage keeps
// working 100% regardless.
//
// Setup (for self-hosters):
//   1. Create a free Supabase project at https://supabase.com
//   2. Run `supabase/migrations/001_initial.sql`
//   3. Configure redirect URLs for Google OAuth (http://127.0.0.1:* loopback)
//   4. Either set env vars at build time, or paste URL+anon key into the
//      Account panel — same effect.

// Type-only import — erased at build, so it pulls NOTHING into the bundle.
// The runtime SDK (~120KB+) is loaded lazily inside getSupabase() via a
// dynamic import, keeping it out of the boot chunk for the local-first
// majority who never configure cloud sync.
import type { SupabaseClient } from '@supabase/supabase-js'

const LS_URL = 'oc.supabaseUrl'
const LS_KEY = 'oc.supabaseAnonKey'

const ENV_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined
const ENV_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

function readCreds(): { url: string | undefined; key: string | undefined } {
  let url: string | undefined
  let key: string | undefined
  try {
    url = localStorage.getItem(LS_URL) || undefined
    key = localStorage.getItem(LS_KEY) || undefined
  } catch {
    /* localStorage unavailable — fall through to env */
  }
  return { url: url || ENV_URL, key: key || ENV_KEY }
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = readCreds()
  return Boolean(url && key)
}

export async function getSupabase(): Promise<SupabaseClient> {
  const { url, key } = readCreds()
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set credentials in Account → Setup, or ' +
      'export VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY at build time.',
    )
  }
  if (!client) {
    // Lazy-load the SDK only when a configured user actually signs in or
    // syncs — its own dynamic chunk, never in the boot bundle. The single
    // cached client is reused for the rest of the session.
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}

/** Persist URL+anon key to localStorage. Caller is responsible for
 *  prompting a reload afterwards (the Supabase client caches internally
 *  and we don't attempt to hot-swap). */
export function setSupabaseCredentials(url: string, anonKey: string): void {
  localStorage.setItem(LS_URL, url.trim())
  localStorage.setItem(LS_KEY, anonKey.trim())
  client = null
}

export function clearSupabaseCredentials(): void {
  localStorage.removeItem(LS_URL)
  localStorage.removeItem(LS_KEY)
  client = null
}
