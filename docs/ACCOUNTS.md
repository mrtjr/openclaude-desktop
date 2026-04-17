# Accounts & Cloud Sync — Setup Guide

OpenClaude Desktop works **100% offline by default**. Accounts and cloud sync
are an **optional** feature you can enable by pointing the app at your own
Supabase project. This document walks through that setup.

> **Zero-knowledge by design.** Your API keys never leave your device in
> plaintext. They're encrypted with AES-256-GCM using a key derived from a
> passphrase that you — and only you — know. Lose the passphrase and the
> ciphertext is useless. That's the point.

---

## Why run your own backend?

OpenClaude is open-source desktop software and ships without a central
server. If a hosted account service existed, the maintainers would hold
your (encrypted) data, your costs, and your abuse risks. Instead, you run
the server half yourself. Supabase's free tier is plenty for personal use.

## What gets synced

| Category              | Plaintext or Encrypted? | Default |
| --------------------- | ----------------------- | ------- |
| Settings (theme, language, default provider) | Plaintext | **On** |
| Agent profiles        | Plaintext               | On     |
| Personas              | Plaintext               | On     |
| Scheduled tasks       | Plaintext               | On     |
| API keys              | **E2EE (passphrase)**   | On     |
| Conversations         | (not synced)            | Off    |
| Agent memory          | (not synced)            | Off    |

---

## 1 — Create a Supabase project

1. Sign up at <https://supabase.com> (free tier is fine).
2. Create a new project. Note the **Project URL** and **anon public key** from
   *Project Settings → API*.

## 2 — Run the schema migration

Open *SQL Editor* in the Supabase dashboard and paste the contents of
`supabase/migrations/001_initial.sql`. Execute.

This creates a single `sync_items` table with Row-Level Security so users
can only ever read/write their own rows.

## 3 — Configure Google OAuth (optional)

1. In the Supabase dashboard: *Authentication → Providers → Google* → enable.
2. In Google Cloud Console: create an **OAuth 2.0 Client ID** (type: Web).
   - Authorized redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`
   - Copy the Client ID + Client Secret back into Supabase.
3. OpenClaude itself uses a **loopback PKCE flow** (RFC 8252) in the Electron
   main process — no additional scheme registration required.

## 4 — Build OpenClaude with your credentials

Set the following environment variables at build time (Vite reads them):

```bash
VITE_SUPABASE_URL="https://<your-project>.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOi…"   # the anon/public key, NOT service_role
npm run dist:win      # or npm run build
```

If these are unset, the Account panel shows a graceful "not configured"
message and the rest of the app continues working offline.

> **Never** ship the `service_role` key in a client build. RLS on `sync_items`
> is only honored for the `anon` key — `service_role` bypasses it.

---

## Security model

**Auth tokens** are handled by `@supabase/supabase-js`, which persists the
session to localStorage. Because Electron enables `contextIsolation` and does
not load third-party JS in the renderer, localStorage access is constrained
to OpenClaude itself.

**Passphrase** is kept **in memory only** (never written to disk). On app
restart, you unlock by re-entering it. If you disable "Sync API keys" you
don't need a passphrase at all — other categories sync in plaintext.

**Key derivation:** PBKDF2-SHA256, 600 000 iterations (OWASP 2023
recommendation). Each encrypted blob uses a fresh 16-byte salt, so rotating
the passphrase is a matter of re-encrypting and re-uploading.

**Symmetric encryption:** AES-256-GCM with a fresh 12-byte IV per blob.
GCM's authenticated encryption means tampered ciphertext fails to decrypt
rather than silently returning garbage.

**Canary blob** (`kind = "canary"`): a known-plaintext encrypted with the
same passphrase, used to verify the user's passphrase on unlock before we
try to decrypt real keys.

### Threat model — what this protects against

- **Database compromise / hosting provider snooping.** Ciphertext alone is
  useless without the passphrase.
- **Passive network observers.** TLS + ciphertext.
- **Cross-user access.** Row-Level Security.

### What this does *not* protect against

- **Malware on your device.** If the attacker is on the machine where you
  type the passphrase, game over — no E2EE scheme helps.
- **A malicious OpenClaude build.** You're trusting the binary. Build from
  source if paranoid.
- **Lost passphrase.** There is no recovery path by design.

---

## Revoking / wiping

- *Sign out:* clears local session + passphrase. Data remains on the server.
- *Delete data on server:* either use the Supabase dashboard, or sign in and
  toggle off each sync category (future versions will add a "delete all"
  button).
- *Rotate passphrase:* disable "Sync API keys", re-enable with a new
  passphrase (this re-encrypts the canary + key blob with the new material).

## References

- RFC 8252 — OAuth 2.0 for Native Apps (loopback flow)
- OWASP Password Storage Cheat Sheet (PBKDF2 iteration counts)
- Supabase PKCE flow: <https://supabase.com/docs/guides/auth/sessions/pkce-flow>
- Bitwarden Security Whitepaper (similar architecture)
