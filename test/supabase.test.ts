// ─── Supabase lazy client tests ────────────────────────────────────
//
// Guards the v2.12.14 boot win: the heavy @supabase/supabase-js SDK must
// load only when a *configured* user actually needs a client. The gate
// (isSupabaseConfigured) stays a cheap localStorage read so the local-first
// majority never pulls the SDK, and getSupabase() is now async (dynamic
// import) — these tests pin that contract.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  isSupabaseConfigured,
  getSupabase,
  setSupabaseCredentials,
  clearSupabaseCredentials,
} from '../src/services/supabase'

describe('supabase lazy client', () => {
  beforeEach(() => clearSupabaseCredentials())

  it('isSupabaseConfigured is false without credentials (cheap, no SDK)', () => {
    expect(isSupabaseConfigured()).toBe(false)
  })

  it('getSupabase rejects when unconfigured — decided before loading the SDK', async () => {
    await expect(getSupabase()).rejects.toThrow(/not configured/i)
  })

  it('lazily constructs a real client once credentials are set', async () => {
    setSupabaseCredentials('https://example.supabase.co', 'anon-key-123')
    expect(isSupabaseConfigured()).toBe(true)
    const sb = await getSupabase()
    // A real GoTrueClient came from the lazily-imported SDK chunk.
    expect(sb).toBeTruthy()
    expect(sb.auth).toBeTruthy()
    clearSupabaseCredentials()
  })
})
