// ─── Servidor remoto (ponte celular ↔ desktop) — v2.191.0 ───────────────
//
// Servidor HTTP local que expõe o chat do OpenClaude para um cliente MÓVEL (a
// PWA em mobile/). Roda no processo MAIN do Electron. Decisão de arquitetura: as
// chaves de API e o motor de chat vivem no RENDERER (provider-chat recebe apiKey
// como parâmetro; settings ficam no localStorage). Por isso este servidor NÃO
// fala direto com os provedores — ele recebe o pedido do celular e o repassa ao
// renderer através de um `chatHandler` injetado (a ponte IPC), que processa com a
// configuração já existente do usuário e devolve o texto.
//
// Exposição à internet é feita via Tailscale (`tailscale serve`), nunca por porta
// aberta no roteador. Mesmo assim, TODA rota /api exige um Bearer token aleatório
// (defesa em profundidade) — o token é o segredo de pareamento mostrado no
// desktop (QR/código). Os helpers puros abaixo são testados em test/remoteServer.
//
// Dependências: apenas built-ins do Node (http/crypto/fs/path) — zero libs novas.

const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

/** MIME por extensão; binário genérico no desconhecido (nunca text/html, p/ não
 *  permitir que um arquivo arbitrário seja servido como página). */
function mimeFor(filePath) {
  return MIME[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream'
}

/** Token de pareamento: 24 bytes aleatórios (192 bits), base64url — inadivinhável. */
function generateToken() {
  return crypto.randomBytes(24).toString('base64url')
}

/** Comparação de token em tempo constante (evita timing-attack). Falsa se algum
 *  lado for vazio ou os tamanhos diferirem. */
function tokenMatches(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  try { return crypto.timingSafeEqual(a, b) } catch { return false }
}

/** Extrai o token do header `Authorization: Bearer <t>` ou do query `?token=`
 *  (o query é necessário p/ a PWA: service worker / navegação não mandam header
 *  facilmente, e o token vem embutido na URL de pareamento). */
function extractToken(req, url) {
  const auth = (req && req.headers && req.headers['authorization']) || ''
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim()
  if (url && url.searchParams) {
    const t = url.searchParams.get('token')
    if (t) return t.trim()
  }
  return ''
}

/** Resolve um caminho estático sob `rootDir`, BLOQUEANDO path traversal
 *  (`..`, caminhos absolutos, symlinks p/ fora). Retorna o caminho absoluto ou
 *  null se escapar da raiz. `/` vira index.html. */
function resolveStaticPath(rootDir, pathname) {
  let rel
  try { rel = decodeURIComponent(String(pathname || '/').split('?')[0]) }
  catch { return null } // %-encoding malformado
  if (rel === '/' || rel === '') rel = '/index.html'
  // tira barras iniciais p/ join não tratar como absoluto
  rel = rel.replace(/^[/\\]+/, '')
  const root = path.normalize(rootDir)
  const full = path.normalize(path.join(root, rel))
  // precisa estar DENTRO da raiz (ou ser a própria raiz)
  if (full !== root && !full.startsWith(root + path.sep)) return null
  return full
}

/** Valida/normaliza o corpo do POST /api/chat. Mantém só role+content (strings),
 *  limita tamanho por mensagem, exige ao menos 1 mensagem válida. Não confia em
 *  nada que venha do celular. Retorna {ok, value} ou {ok:false, error}. */
function parseChatBody(raw) {
  let obj
  try { obj = JSON.parse(raw || '') } catch { return { ok: false, error: 'JSON inválido' } }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'corpo inválido' }
  const arr = Array.isArray(obj.messages) ? obj.messages : null
  if (!arr || !arr.length) return { ok: false, error: 'campo "messages" vazio ou ausente' }
  const clean = arr
    .filter((m) => m && typeof m === 'object' && typeof m.content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content).slice(0, 100000),
    }))
    .filter((m) => m.content.length > 0)
  if (!clean.length) return { ok: false, error: 'nenhuma mensagem válida' }
  return {
    ok: true,
    value: {
      messages: clean,
      model: obj.model != null ? String(obj.model).slice(0, 200) : undefined,
      provider: obj.provider != null ? String(obj.provider).slice(0, 50) : undefined,
    },
  }
}

/** Lê o corpo da requisição com teto de bytes (anti-DoS). Rejeita se exceder. */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []
    req.on('data', (c) => {
      total += c.length
      if (total > maxBytes) { reject(new Error('corpo muito grande')); try { req.destroy() } catch { /* noop */ } }
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Cria o servidor remoto. Injeta-se:
 *  - staticDir: pasta da PWA (mobile/)
 *  - getToken(): retorna o token de pareamento atual (string)
 *  - getInfo(): retorna metadados públicos do app (nome, versão, modelos) p/ a UI
 *  - chatHandler({messages,model,provider}) -> Promise<{text,error,model}>
 *    (a ponte com o renderer; é onde o chat de verdade acontece)
 *  - maxBodyBytes (opcional)
 * Retorna { start(port), stop(), isRunning(), port() }.
 */
function createRemoteServer(opts) {
  const maxBody = opts.maxBodyBytes || 2 * 1024 * 1024 // 2MB
  let server = null
  let listenPort = 0

  const sendJson = (res, status, obj) => {
    const body = JSON.stringify(obj)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(body)
  }
  const serveStatic = (res, pathname) => {
    const filePath = resolveStaticPath(opts.staticDir, pathname)
    if (!filePath) return sendJson(res, 403, { error: 'forbidden' })
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // Fallback SPA: rota desconhecida → index.html (a PWA roteia no cliente).
        fs.readFile(path.join(path.normalize(opts.staticDir), 'index.html'), (e2, d2) => {
          if (e2) return sendJson(res, 404, { error: 'não encontrado' })
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(d2)
        })
        return
      }
      res.writeHead(200, { 'Content-Type': mimeFor(filePath), 'Cache-Control': 'no-store' })
      res.end(data)
    })
  }

  async function handle(req, res) {
    let url
    try { url = new URL(req.url, 'http://localhost') } catch { return sendJson(res, 400, { error: 'url inválida' }) }
    const pathname = url.pathname

    // Health: SEM auth (só checagem de conectividade; não vaza nada sensível).
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true })

    if (pathname.startsWith('/api/')) {
      // Toda rota /api (exceto health) exige o token de pareamento.
      if (!tokenMatches(extractToken(req, url), opts.getToken())) {
        return sendJson(res, 401, { error: 'não autorizado' })
      }
      if (pathname === '/api/info' && req.method === 'GET') {
        let info = {}
        try { info = (opts.getInfo && opts.getInfo()) || {} } catch { info = {} }
        return sendJson(res, 200, info)
      }
      if (pathname === '/api/chat' && req.method === 'POST') {
        let raw
        try { raw = await readBody(req, maxBody) } catch (e) { return sendJson(res, 413, { error: e.message || 'corpo muito grande' }) }
        const parsed = parseChatBody(raw)
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.error })
        // ─── SSE: streaming ao vivo (v2.193.0) ───────────────────────────────
        // Os tokens chegam conforme a IA escreve. Um heartbeat a cada 10s mantém
        // a conexão VIVA para respostas longas/lentas (ex.: GLM) — sem isso o iOS
        // e o túnel cortam a espera ("context canceled"). chatHandler agora recebe
        // callbacks {onChunk,onDone,onError} em vez de retornar texto.
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        let closed = false
        const hb = setInterval(() => { if (!closed) { try { res.write(': hb\n\n') } catch { /* */ } } }, 10000)
        const end = () => { if (closed) return; closed = true; clearInterval(hb); try { res.end() } catch { /* */ } }
        const sse = (obj) => { if (!closed) { try { res.write(`data: ${JSON.stringify(obj)}\n\n`) } catch { /* */ } } }
        // Cliente desligou (fechou o app/perdeu rede) → para os heartbeats e avisa.
        res.on('close', () => { if (!closed) { closed = true; clearInterval(hb); try { opts.onClientGone && opts.onClientGone(parsed.value) } catch { /* */ } } })
        try {
          opts.chatHandler(parsed.value, {
            onChunk: (delta) => { if (delta) sse({ delta: String(delta) }) },
            onDone: (text, model) => { sse({ done: true, text: text || '', model }); end() },
            onError: (error) => { sse({ error: String(error || 'erro') }); end() },
          })
        } catch (e) { sse({ error: (e && e.message) || 'erro interno' }); end() }
        return
      }
      return sendJson(res, 404, { error: 'rota não encontrada' })
    }

    // Estático (a PWA). Só GET/HEAD.
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'método não permitido' })
    return serveStatic(res, pathname)
  }

  function start(port, host) {
    return new Promise((resolve, reject) => {
      if (server) return resolve({ port: listenPort })
      server = http.createServer((req, res) => {
        handle(req, res).catch((e) => {
          try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: (e && e.message) || 'erro' })) } catch { /* noop */ }
        })
      })
      server.on('error', (e) => { server = null; reject(e) })
      // 0.0.0.0: alcançável tanto pela LAN (Wi-Fi de casa, IP local) quanto pelo
      // Tailscale (away/dados móveis). A proteção é o token aleatório; NÃO há
      // porta aberta no roteador (sem port-forward).
      server.listen(port || 0, host || '0.0.0.0', () => {
        listenPort = server.address().port
        resolve({ port: listenPort })
      })
    })
  }
  function stop() {
    return new Promise((resolve) => {
      if (!server) return resolve()
      server.close(() => { server = null; listenPort = 0; resolve() })
    })
  }

  return {
    start,
    stop,
    isRunning: () => !!server,
    port: () => listenPort,
  }
}

module.exports = {
  createRemoteServer,
  // helpers puros (testados):
  mimeFor,
  generateToken,
  tokenMatches,
  extractToken,
  resolveStaticPath,
  parseChatBody,
}
