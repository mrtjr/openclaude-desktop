// ─── OAuth loopback (PKCE) for Supabase + Google ──────────────────
//
// Implements RFC 8252 (OAuth 2.0 for Native Apps) loopback redirect flow.
// This is the recommended approach for desktop apps by Google + IETF — no
// custom URL scheme handler needed, no embedded webview (which Google blocks).
//
// Flow:
//   1. Generate PKCE code_verifier + code_challenge (S256)
//   2. Start HTTP server on 127.0.0.1:<random ephemeral port>
//   3. Build Supabase authorize URL with redirect_to = http://127.0.0.1:<port>
//   4. Open system browser (shell.openExternal)
//   5. Google → Supabase → redirects back to loopback with ?code=...
//   6. Exchange code + verifier at Supabase /auth/v1/token?grant_type=pkce
//   7. Return session JSON to renderer
//
// References:
//   - https://datatracker.ietf.org/doc/html/rfc8252
//   - https://supabase.com/docs/guides/auth/sessions/pkce-flow
//   - https://developers.google.com/identity/protocols/oauth2/native-app

const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { shell } = require('electron')

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes to complete sign-in

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function httpsJson(urlStr, opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const req = https.request(
      {
        method: opts.method || 'GET',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: opts.headers || {},
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          try {
            resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })
          } catch (e) {
            resolve({ status: res.statusCode, body: text })
          }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

const SUCCESS_HTML = `<!doctype html><meta charset=utf-8><title>OpenClaude</title>
<style>body{font-family:system-ui;background:#0b1020;color:#e6e9f2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{padding:2rem 3rem;border:1px solid #2a3153;border-radius:12px;text-align:center}
h1{margin:0 0 .5rem;font-size:1.5rem}p{opacity:.7;margin:0}</style>
<div class=card><h1>✓ Login concluído</h1><p>Você pode fechar esta aba e voltar ao OpenClaude.</p></div>`

const ERROR_HTML = (msg) => `<!doctype html><meta charset=utf-8><title>OpenClaude</title>
<style>body{font-family:system-ui;background:#0b1020;color:#e6e9f2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{padding:2rem 3rem;border:1px solid #5a2030;border-radius:12px;text-align:center}
h1{margin:0 0 .5rem;font-size:1.5rem;color:#ff6b80}p{opacity:.7;margin:0}</style>
<div class=card><h1>✗ Falha no login</h1><p>${msg}</p></div>`

/**
 * Starts the Google OAuth loopback flow.
 * @param {{supabaseUrl:string, anonKey:string}} params
 * @returns {Promise<{session?:object, error?:string}>}
 */
async function startGoogleOAuth({ supabaseUrl, anonKey }) {
  if (!supabaseUrl || !anonKey) {
    return { error: 'Supabase não configurado (URL/anon key ausentes).' }
  }

  const { verifier, challenge } = generatePkce()
  const state = base64url(crypto.randomBytes(16))

  return new Promise((resolve) => {
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { server.close() } catch {}
      resolve(result)
    }

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://127.0.0.1`)
        if (reqUrl.pathname !== '/' && reqUrl.pathname !== '/callback') {
          res.writeHead(404); res.end(); return
        }
        const code = reqUrl.searchParams.get('code')
        const returnedState = reqUrl.searchParams.get('state')
        const err = reqUrl.searchParams.get('error_description') || reqUrl.searchParams.get('error')

        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(ERROR_HTML(String(err).slice(0, 200)))
          return settle({ error: String(err) })
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(ERROR_HTML('Código de autorização ausente.'))
          return settle({ error: 'missing_code' })
        }
        if (returnedState && returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(ERROR_HTML('State inválido — possível CSRF.'))
          return settle({ error: 'state_mismatch' })
        }

        // Exchange code for session via Supabase PKCE endpoint
        const tokenUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=pkce`
        const tokenRes = await httpsJson(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
          },
        }, { auth_code: code, code_verifier: verifier })

        if (tokenRes.status >= 400 || !tokenRes.body?.access_token) {
          const msg = tokenRes.body?.error_description || tokenRes.body?.msg || `HTTP ${tokenRes.status}`
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(ERROR_HTML(msg))
          return settle({ error: msg })
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(SUCCESS_HTML)
        settle({ session: tokenRes.body })
      } catch (e) {
        try {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(ERROR_HTML(e.message || 'Erro desconhecido'))
        } catch {}
        settle({ error: e.message || String(e) })
      }
    })

    server.on('error', (e) => settle({ error: `loopback_server: ${e.message}` }))

    const timer = setTimeout(() => settle({ error: 'timeout' }), TIMEOUT_MS)

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const redirectTo = `http://127.0.0.1:${port}/callback`
      const authUrl =
        `${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize?` +
        new URLSearchParams({
          provider: 'google',
          redirect_to: redirectTo,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }).toString()
      shell.openExternal(authUrl).catch((e) =>
        settle({ error: `openExternal: ${e.message}` }),
      )
    })
  })
}

module.exports = { startGoogleOAuth }
