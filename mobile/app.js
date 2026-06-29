// ─── OpenClaude PWA (celular) — app.js — v2.194.0 ─────────────────────────
// Chat mobile com streaming ao vivo, parar/regenerar/copiar, cronômetro de
// espera (modelos lentos como o GLM), chips de sugestão e troca de modelo.

const $ = (id) => document.getElementById(id)
const LS_TOKEN = 'oc_remote_token', LS_HISTORY = 'oc_remote_history', LS_TARGET = 'oc_remote_target'
const LS_CONVS = 'oc_conversations', LS_CURRENT = 'oc_current_conv'

const state = {
  token: '', messages: [], targets: [], targetId: '', busy: false,
  abort: null,           // AbortController do streaming atual
  lastUser: '',          // última mensagem do usuário (p/ regenerar)
  conversations: [],     // [{id,title,messages,updatedAt}]
  currentId: '',
}

const EMPTY_HTML = '<div id="empty" class="empty"><div class="empty-logo">◈</div><p class="empty-title">Como posso ajudar?</p><p class="empty-sub">Sua IA local e a principal do desktop — de qualquer lugar.</p><div id="chips" class="chips"><button class="chip">Resuma esta ideia: </button><button class="chip">Escreva um e-mail para </button><button class="chip">Me explique como </button><button class="chip">Crie um plano para </button></div></div>'
function showEmpty() { $('messages').innerHTML = EMPTY_HTML }

const haptic = (ms) => { try { navigator.vibrate && navigator.vibrate(ms) } catch (e) {} }

// ── Markdown seguro ─────────────────────────────────────────────────
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function mdTable(block) {
  // bloco de linhas que começam/terminam com | → tabela
  const rows = block.split('\n').filter((l) => l.trim().startsWith('|'))
  if (rows.length < 2) return null
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const head = cells(rows[0])
  const body = rows.slice(2).map(cells) // pula a linha separadora ---|---
  const th = head.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
  const trs = body.map((r) => '<tr>' + r.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('')
  return `<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
}
function renderMarkdown(md) {
  const blocks = []
  let text = String(md).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => { blocks.push({ lang: lang || '', code }); return ` B${blocks.length - 1} ` })
  // tabelas (antes de escapar — extrai e guarda o HTML pronto)
  const tables = []
  text = text.replace(/(?:^\|.*\|[ \t]*\n?){2,}/gm, (m) => { const t = mdTable(m); if (!t) return m; tables.push(t); return ` T${tables.length - 1} ` })
  text = escapeHtml(text)
  text = text.replace(/`([^`\n]+)`/g, (_, c) => `<code class="inline">${c}</code>`)
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
  text = text.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^##? (.*)$/gm, '<h2>$1</h2>')
  text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  text = text.replace(/^\s*[-*] (.+)$/gm, '• $1')
  text = text.replace(/\n/g, '<br>')
  text = text.replace(/ T(\d+) /g, (_, i) => tables[i])
  text = text.replace(/ B(\d+) /g, (_, i) => {
    const b = blocks[i]
    return `<pre class="code"><div class="code-head"><span>${escapeHtml(b.lang || 'code')}</span><button class="code-copy" data-code="${encodeURIComponent(b.code)}">copiar</button></div><code>${escapeHtml(b.code)}</code></pre>`
  })
  return text
}

// ── Token / API ─────────────────────────────────────────────────────
function readTokenFromUrl() {
  try {
    const u = new URL(location.href); const t = u.searchParams.get('token')
    if (t) { localStorage.setItem(LS_TOKEN, t); u.searchParams.delete('token'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); return t }
  } catch (e) {}
  return localStorage.getItem(LS_TOKEN) || ''
}
function api(path, opts = {}) {
  const headers = Object.assign({ 'Authorization': 'Bearer ' + state.token }, opts.headers || {})
  return fetch(path, Object.assign({}, opts, { headers }))
}
async function checkConnection() {
  try {
    const r = await api('/api/info'); if (r.status === 401) return { ok: false, auth: false }
    if (!r.ok) return { ok: false }; return { ok: true, info: await r.json() }
  } catch (e) { return { ok: false, network: true } }
}

// ── Alvos / modelo ──────────────────────────────────────────────────
function applyTargets(info) {
  const list = Array.isArray(info?.targets) && info.targets.length ? info.targets
    : [{ id: 'main', label: (info?.provider ? info.provider + ': ' : '') + (info?.model || '—'), provider: info?.provider || 'ollama', model: info?.model || '' }]
  state.targets = list
  const saved = localStorage.getItem(LS_TARGET)
  state.targetId = list.some((t) => t.id === saved) ? saved : list[0].id
  setModelBadge()
}
function currentTarget() { return state.targets.find((t) => t.id === state.targetId) || state.targets[0] }
function setModelBadge() {
  const t = currentTarget()
  $('model').textContent = (t ? t.label.replace(/^Ollama \(local\): /, '').replace(/^[a-z]+: /, '') : '—').slice(0, 26)
}

// ── UI helpers ──────────────────────────────────────────────────────
function setDot(cls) { $('dot').className = 'dot' + (cls ? ' ' + cls : '') }
function nearBottom() { const m = $('messages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 80 }
function scrollToEnd(force) { const m = $('messages'); if (force || nearBottom()) m.scrollTop = m.scrollHeight }
function updateScrollBtn() { $('scrollBtn').classList.toggle('hidden', nearBottom()) }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); requestAnimationFrame(() => t.classList.add('show')); clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 200) }, 1600) }

// Cria uma linha de mensagem. Retorna controles para streaming.
function addRow(role, content) {
  const empty = $('empty'); if (empty) empty.remove()
  const row = document.createElement('div'); row.className = 'row ' + role
  const msg = document.createElement('div'); msg.className = 'msg'
  if (role === 'assistant') msg.innerHTML = renderMarkdown(content || '')
  else msg.textContent = content
  row.appendChild(msg)
  $('messages').appendChild(row)
  scrollToEnd(true)
  return { row, msg }
}
function addActions(row, getText) {
  if (row.querySelector('.msg-actions')) return
  const bar = document.createElement('div'); bar.className = 'msg-actions'
  const copy = document.createElement('button'); copy.className = 'msg-act'
  copy.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" d="M9 9h10v10H9zM5 15V5h10"/></svg> Copiar'
  copy.onclick = () => { navigator.clipboard.writeText(getText()).then(() => { haptic(8); toast('Copiado') }).catch(() => {}) }
  const regen = document.createElement('button'); regen.className = 'msg-act'
  regen.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-5h5"/></svg> Regenerar'
  regen.onclick = regenerate
  bar.appendChild(copy); bar.appendChild(regen); row.appendChild(bar)
}

function renderHistory() {
  for (const m of state.messages) {
    const { row } = addRow(m.role === 'user' ? 'user' : 'assistant', m.content)
    if (m.role === 'assistant') addActions(row, () => m.content)
  }
}

// ── Conversas (histórico, igual ChatGPT/Claude) ─────────────────────
const cid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const titleFrom = (msgs) => { const u = (msgs || []).find((m) => m.role === 'user'); return u ? u.content.trim().slice(0, 42) : 'Nova conversa' }
function currentConv() { return state.conversations.find((c) => c.id === state.currentId) || state.conversations[0] }
function loadConvs() {
  try { state.conversations = JSON.parse(localStorage.getItem(LS_CONVS) || '[]') || [] } catch (e) { state.conversations = [] }
  if (!state.conversations.length) {
    let old = []; try { old = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') || [] } catch (e) {}
    state.conversations = [{ id: cid(), title: titleFrom(old), messages: old, updatedAt: Date.now() }]
    localStorage.removeItem(LS_HISTORY)
  }
  state.currentId = localStorage.getItem(LS_CURRENT) || ''
  if (!state.conversations.some((c) => c.id === state.currentId)) state.currentId = state.conversations[0].id
  state.messages = currentConv().messages
}
function persist() {
  const c = currentConv()
  if (c) { c.messages = state.messages; c.updatedAt = Date.now(); if (!c.title || c.title === 'Nova conversa') c.title = titleFrom(state.messages) }
  try { localStorage.setItem(LS_CONVS, JSON.stringify(state.conversations.slice(0, 60))); localStorage.setItem(LS_CURRENT, state.currentId) } catch (e) {}
}
const saveHistory = persist // alias usado no resto do código
function newConversation() {
  const cur = currentConv()
  if (cur && !cur.messages.length) { closeDrawer(); return } // já está numa vazia
  const c = { id: cid(), title: 'Nova conversa', messages: [], updatedAt: Date.now() }
  state.conversations.unshift(c); state.currentId = c.id; state.messages = c.messages
  persist(); showEmpty(); closeDrawer(); haptic(8)
}
function switchConv(id) {
  persist(); state.currentId = id; state.messages = currentConv().messages
  localStorage.setItem(LS_CURRENT, id); $('messages').innerHTML = ''
  if (state.messages.length) renderHistory(); else showEmpty()
  closeDrawer(); haptic(6)
}
function deleteConv(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id)
  if (!state.conversations.length) state.conversations = [{ id: cid(), title: 'Nova conversa', messages: [], updatedAt: Date.now() }]
  if (state.currentId === id) { state.currentId = state.conversations[0].id; state.messages = currentConv().messages; $('messages').innerHTML = ''; state.messages.length ? renderHistory() : showEmpty() }
  persist(); renderDrawer()
}
function renderDrawer() {
  const list = $('convList'); list.innerHTML = ''
  const sorted = [...state.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  if (!sorted.length) { list.innerHTML = '<div class="conv-empty">Nenhuma conversa</div>'; return }
  for (const c of sorted) {
    const item = document.createElement('div'); item.className = 'conv-item' + (c.id === state.currentId ? ' active' : '')
    item.innerHTML = `<span class="c-title">${escapeHtml(c.title || 'Nova conversa')}</span><button class="c-del" aria-label="Apagar">✕</button>`
    item.onclick = (e) => { if (!e.target.closest('.c-del')) switchConv(c.id) }
    item.querySelector('.c-del').onclick = (e) => { e.stopPropagation(); deleteConv(c.id) }
    list.appendChild(item)
  }
}
function openDrawer() { renderDrawer(); $('drawer').classList.remove('hidden') }
function closeDrawer() { $('drawer').classList.add('hidden') }

// ── Botão enviar/parar ──────────────────────────────────────────────
function setBusy(on) {
  state.busy = on
  $('send').classList.toggle('stop', on)
  $('send').querySelector('.ic-send').classList.toggle('hidden', on)
  $('send').querySelector('.ic-stop').classList.toggle('hidden', !on)
}
function stop() { if (state.abort) { try { state.abort.abort() } catch (e) {} } }

// ── Envio / streaming ───────────────────────────────────────────────
function send(text) {
  if (!text.trim() || state.busy) return
  const t = text.trim()
  state.lastUser = t
  state.messages.push({ role: 'user', content: t })
  addRow('user', t); saveHistory(); haptic(8)
  runChat()
}

function regenerate() {
  if (state.busy) return
  // remove a última resposta do assistente (estado + tela) e refaz
  if (state.messages.length && state.messages[state.messages.length - 1].role === 'assistant') state.messages.pop()
  const rows = $('messages').querySelectorAll('.row.assistant, .row.error')
  if (rows.length) rows[rows.length - 1].remove()
  saveHistory(); haptic(8); runChat()
}

async function runChat(retried) {
  const target = currentTarget()
  setBusy(true); setDot('busy')
  $('typing').classList.remove('hidden')
  // cronômetro de espera (modelos lentos não parecem travados)
  const t0 = Date.now()
  $('elapsed').textContent = ''
  const timer = setInterval(() => { $('elapsed').textContent = Math.round((Date.now() - t0) / 1000) + 's' }, 1000)

  state.abort = new AbortController()
  let bubble = null, acc = '', err = null, stopped = false, lastRender = 0
  const ensure = () => { if (bubble) return; clearInterval(timer); $('typing').classList.add('hidden'); const r = addRow('assistant', ''); bubble = r; bubble.msg.classList.add('cursor') }
  const renderLive = () => { const now = Date.now(); if (now - lastRender > 40) { lastRender = now; bubble.msg.textContent = acc; scrollToEnd() } }

  try {
    const r = await api('/api/chat', {
      method: 'POST', signal: state.abort.signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ messages: state.messages, provider: target && target.provider, model: target && target.model }),
    })
    if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); err = (d && d.error) || ('Erro ' + r.status) }
    else {
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '', done = false
      while (!done) {
        const { value, done: rd } = await reader.read(); if (rd) break
        buf += dec.decode(value, { stream: true })
        const evs = buf.split('\n\n'); buf = evs.pop()
        for (const ev of evs) {
          const line = ev.split('\n').find((l) => l.startsWith('data:')); if (!line) continue
          let obj; try { obj = JSON.parse(line.slice(5).trim()) } catch (e) { continue }
          if (obj.error) { err = obj.error; done = true; break }
          if (obj.delta) { ensure(); acc += obj.delta; renderLive() }
          if (obj.done) { acc = obj.text || acc; done = true; break }
        }
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') { stopped = true } else { err = 'Conexão interrompida. Tente de novo (mantenha a tela ligada).' }
  }

  clearInterval(timer); $('typing').classList.add('hidden'); state.abort = null; setBusy(false)

  // Auto-retry uma vez em queda de rede SEM nada recebido (provável blip do túnel).
  if (err && !retried && !acc && /interrompida|Erro 5|conex/i.test(err)) {
    if (bubble) bubble.row.remove()
    setDot('busy'); toast('Reconectando…')
    setTimeout(() => runChat(true), 1300)
    return
  }

  if (err) {
    if (bubble) bubble.row.remove()
    setDot('bad'); const { row } = addRow('error', err)
    // botão tentar de novo no erro
    const bar = document.createElement('div'); bar.className = 'msg-actions'
    const retry = document.createElement('button'); retry.className = 'msg-act'
    retry.innerHTML = '↻ Tentar de novo'; retry.onclick = () => { row.remove(); regenerate() }
    row.appendChild(bar); bar.appendChild(retry)
    return
  }
  setDot('ok')
  ensure()
  bubble.msg.classList.remove('cursor')
  const finalText = acc || (stopped ? '(parado)' : '(sem resposta)')
  bubble.msg.innerHTML = renderMarkdown(finalText)
  addActions(bubble.row, () => finalText)
  state.messages.push({ role: 'assistant', content: finalText })
  saveHistory(); scrollToEnd(); haptic(6)
}

// ── Composer ────────────────────────────────────────────────────────
function wireComposer() {
  const input = $('input')
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px' }
  input.addEventListener('input', grow)
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault()
    if (state.busy) { stop(); return } // botão vira "parar" enquanto responde
    const v = input.value; input.value = ''; grow(); send(v)
  })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit() } })
  $('messages').addEventListener('scroll', updateScrollBtn)
  $('scrollBtn').addEventListener('click', () => scrollToEnd(true))
  $('newChatBtn').addEventListener('click', () => { if (!state.busy) newConversation() })
  // chips por delegação (a tela vazia é recriada ao trocar de conversa)
  $('messages').addEventListener('click', (e) => { const chip = e.target.closest('.chip'); if (chip) { input.value = chip.textContent; input.focus(); grow() } })
}
function wireDrawer() {
  $('menuBtn').addEventListener('click', openDrawer)
  $('drawer').querySelector('.drawer-backdrop').addEventListener('click', closeDrawer)
  $('drawerNew').addEventListener('click', newConversation)
}
function wireVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return // sem suporte → microfone fica escondido
  $('micBtn').classList.remove('hidden')
  let rec = null, listening = false
  $('micBtn').addEventListener('click', () => {
    if (listening) { try { rec.stop() } catch (e) {} return }
    rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = false
    const base = $('input').value
    rec.onstart = () => { listening = true; $('micBtn').classList.add('rec'); haptic(10) }
    rec.onresult = (e) => { let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript; $('input').value = (base ? base + ' ' : '') + txt; $('input').dispatchEvent(new Event('input')) }
    rec.onerror = () => {}
    rec.onend = () => { listening = false; $('micBtn').classList.remove('rec') }
    try { rec.start() } catch (e) {}
  })
}

// copiar bloco de código
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.code-copy'); if (!btn) return
  try { navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code || '')); btn.textContent = 'copiado ✓'; haptic(8); setTimeout(() => (btn.textContent = 'copiar'), 1400) } catch (err) {}
})

// ── Sheet ───────────────────────────────────────────────────────────
function renderTargets() {
  const wrap = $('targets'); wrap.innerHTML = ''
  for (const t of state.targets) {
    const row = document.createElement('button'); row.className = 'target' + (t.id === state.targetId ? ' active' : '')
    row.innerHTML = `<span class="radio"></span><span class="t-label">${escapeHtml(t.label)}</span>`
    row.onclick = () => { state.targetId = t.id; localStorage.setItem(LS_TARGET, t.id); setModelBadge(); renderTargets(); closeSheet(); haptic(8) }
    wrap.appendChild(row)
  }
}
function openSheet() { renderTargets(); $('sheet').classList.remove('hidden') }
function closeSheet() { $('sheet').classList.add('hidden') }
function wireSheet() {
  $('modelBtn').addEventListener('click', openSheet)
  $('sheet').querySelector('.sheet-backdrop').addEventListener('click', closeSheet)
  $('clearBtn').addEventListener('click', () => { state.messages.length = 0; persist(); showEmpty(); closeSheet() })
  $('repairBtn').addEventListener('click', () => { localStorage.removeItem(LS_TOKEN); location.reload() })
}

// ── Pareamento ──────────────────────────────────────────────────────
function showPair(errMsg) {
  $('pair').classList.remove('hidden')
  if (errMsg) $('pairErr').textContent = errMsg
  $('pairBtn').onclick = async () => {
    const raw = $('pairToken').value.trim(); if (!raw) return
    let tok = raw; try { const u = new URL(raw); tok = u.searchParams.get('token') || raw } catch (e) {}
    state.token = tok; const c = await checkConnection()
    if (c.ok) { localStorage.setItem(LS_TOKEN, tok); $('pair').classList.add('hidden'); applyTargets(c.info); setDot('ok'); loadConvs(); state.messages.length ? renderHistory() : showEmpty() }
    else $('pairErr').textContent = c.network ? 'Sem conexão com o PC (Tailscale / app aberto?).' : 'Código inválido.'
  }
}

// ── Boot ────────────────────────────────────────────────────────────
async function boot() {
  state.token = readTokenFromUrl()
  if (!state.token) { setDot('bad'); showPair(''); return }
  const c = await checkConnection()
  if (!c.ok) { setDot('bad'); showPair(c.auth === false ? 'Pareamento expirado. Cole o novo código do desktop.' : c.network ? 'Sem conexão com o PC. Abra o app no PC e ligue o Tailscale.' : 'Falha ao conectar.'); return }
  setDot('ok'); applyTargets(c.info); loadConvs(); state.messages.length ? renderHistory() : showEmpty()
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
wireComposer(); wireSheet(); wireDrawer(); wireVoice(); boot()
