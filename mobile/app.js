// ─── OpenClaude PWA (celular) — app.js — v2.191.0 ─────────────────────────
// Cliente de chat que fala com o servidor do desktop (electron/remote-server.js)
// via /api/chat. O token de pareamento vem na URL (?token=) ou do localStorage.
// v1 é NÃO-streaming: manda as mensagens, mostra "digitando", recebe o texto.

const $ = (id) => document.getElementById(id)
const LS_TOKEN = 'oc_remote_token'
const LS_HISTORY = 'oc_remote_history'

const state = {
  token: '',
  messages: [],     // {role, content}
  provider: '',
  model: '',
  busy: false,
}

// ── Token / pareamento ──────────────────────────────────────────────
function readTokenFromUrl() {
  try {
    const u = new URL(location.href)
    const t = u.searchParams.get('token')
    if (t) {
      localStorage.setItem(LS_TOKEN, t)
      // Tira o token da URL (não fica no histórico/compartilhável).
      u.searchParams.delete('token')
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash)
      return t
    }
  } catch (e) { /* ignore */ }
  return localStorage.getItem(LS_TOKEN) || ''
}

function api(path, opts = {}) {
  const headers = Object.assign({ 'Authorization': 'Bearer ' + state.token }, opts.headers || {})
  return fetch(path, Object.assign({}, opts, { headers }))
}

async function checkConnection() {
  try {
    const r = await api('/api/info')
    if (r.status === 401) return { ok: false, auth: false }
    if (!r.ok) return { ok: false }
    const info = await r.json()
    state.provider = info.provider || ''
    state.model = info.model || ''
    return { ok: true, info }
  } catch (e) {
    return { ok: false, network: true }
  }
}

// ── Render ──────────────────────────────────────────────────────────
function setDot(cls) { const d = $('dot'); d.className = 'dot' + (cls ? ' ' + cls : '') }
function setModelBadge() {
  const m = state.model || '—'
  const p = state.provider && state.provider !== 'ollama' ? state.provider + ': ' : ''
  $('model').textContent = (p + m).slice(0, 40)
}
function scrollToEnd() { const m = $('messages'); m.scrollTop = m.scrollHeight }

function addBubble(role, content) {
  const empty = $('empty'); if (empty) empty.remove()
  const div = document.createElement('div')
  div.className = 'msg ' + (role === 'user' ? 'user' : role === 'error' ? 'error' : 'assistant')
  div.textContent = content
  $('messages').appendChild(div)
  scrollToEnd()
  return div
}

function renderHistory() {
  for (const m of state.messages) addBubble(m.role, m.content)
}

function saveHistory() {
  try { localStorage.setItem(LS_HISTORY, JSON.stringify(state.messages.slice(-100))) } catch (e) { /* quota */ }
}
function loadHistory() {
  try { state.messages = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') || [] }
  catch (e) { state.messages = [] }
}

// ── Envio ───────────────────────────────────────────────────────────
async function send(text) {
  if (state.busy || !text.trim()) return
  state.busy = true
  $('send').disabled = true
  const userMsg = { role: 'user', content: text.trim() }
  state.messages.push(userMsg)
  addBubble('user', userMsg.content)
  saveHistory()
  $('typing').classList.remove('hidden')
  scrollToEnd()

  try {
    const r = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages }),
    })
    const data = await r.json().catch(() => ({}))
    $('typing').classList.add('hidden')
    if (!r.ok || data.error) {
      addBubble('error', data.error || ('Erro ' + r.status))
    } else {
      const reply = { role: 'assistant', content: data.text || '(sem resposta)' }
      state.messages.push(reply)
      addBubble('assistant', reply.content)
      saveHistory()
    }
  } catch (e) {
    $('typing').classList.add('hidden')
    addBubble('error', 'Sem conexão com o desktop. Verifique o Tailscale / se o app está aberto no PC.')
  } finally {
    state.busy = false
    $('send').disabled = false
  }
}

// ── Composer (auto-grow + Enter envia) ──────────────────────────────
function wireComposer() {
  const input = $('input')
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px' }
  input.addEventListener('input', grow)
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault()
    const t = input.value
    input.value = ''; grow()
    send(t)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit() }
  })
}

function wireMenu() {
  $('menuBtn').addEventListener('click', () => {
    const choice = prompt('Menu:\n1 = Limpar conversa\n2 = Reparear (esquecer este PC)\n\nDigite o número:')
    if (choice === '1') {
      state.messages = []; saveHistory()
      const m = $('messages'); m.innerHTML = ''
    } else if (choice === '2') {
      localStorage.removeItem(LS_TOKEN)
      location.reload()
    }
  })
}

// ── Pareamento (tela inicial quando não há token válido) ────────────
function showPair(errMsg) {
  $('pair').classList.remove('hidden')
  if (errMsg) $('pairErr').textContent = errMsg
  $('pairBtn').onclick = async () => {
    const raw = $('pairToken').value.trim()
    if (!raw) return
    // Aceita tanto o token puro quanto a URL completa com ?token=.
    let tok = raw
    try { const u = new URL(raw); tok = u.searchParams.get('token') || raw } catch (e) { /* não é URL */ }
    state.token = tok
    const c = await checkConnection()
    if (c.ok) { localStorage.setItem(LS_TOKEN, tok); $('pair').classList.add('hidden'); boot(true) }
    else $('pairErr').textContent = c.network ? 'Sem conexão com o PC (Tailscale/app aberto?).' : 'Código inválido.'
  }
}

// ── Boot ────────────────────────────────────────────────────────────
async function boot(skipTokenRead) {
  if (!skipTokenRead) state.token = readTokenFromUrl()
  if (!state.token) { setDot('bad'); showPair(''); return }
  const c = await checkConnection()
  if (!c.ok) {
    setDot('bad')
    if (c.auth === false) { showPair('Pareamento expirado. Cole o novo código do desktop.') }
    else { showPair(c.network ? 'Sem conexão com o PC. Abra o app no PC e ligue o Tailscale.' : 'Falha ao conectar.') }
    return
  }
  setDot('ok'); setModelBadge()
  loadHistory(); renderHistory()
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem SW: app ainda funciona online */ })
}
wireComposer(); wireMenu()
boot()
