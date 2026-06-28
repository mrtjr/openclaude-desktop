const { app, BrowserWindow, ipcMain, shell, Tray, Menu, globalShortcut, dialog, nativeImage } = require('electron')
const { exec, execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const dns = require('dns')
const { ipToBlockReason, hostnameBlockReason } = require('./ssrf-guard')
const { sanitizeChildEnv } = require('./exec-env')
const { formatMcpContent } = require('./mcp-format')

const os = require('os')
const { atomicWriteJSON, readJSONWithFallback } = require('./atomic-write')
const { providerTimeoutMs, createStallWatchdog } = require('./provider-timeouts')
const { reasoningRequestParams, anthropicAcceptsTemperature } = require('./reasoning-control')
const { toAnthropicContent, toGeminiParts } = require('./multimodal')
const { cachedSystem, withCachedTools } = require('./anthropic-cache')
const { resolveNavOutcome } = require('./browser-nav')
const { buildOrionScript } = require('./orion-script')
const { planScreenshot, SHOT_JPEG_QUALITY } = require('./screenshot-util')
const { initAutoUpdater, quitAndInstall } = require('./updater')
const { dedupeResults, formatResults, cacheKey, isFresh } = require('./web-search-util')
const { htmlToText, extractTitle, looksThin } = require('./web-fetch-util')
const { createRemoteServer, generateToken } = require('./remote-server')

const isDev = process.env.NODE_ENV === 'development'

let win = null
let tray = null
let activeOllamaStream = null
let activeProviderStream = null

// ─── Path safety check (v2.112.0: segment-aware + resolve symlink) ──
// A lista/matching puro vive em electron/path-safety.js (testado). Aqui só a
// parte impura: resolver symlinks (realpath) ANTES de checar — assim um link
// apontando para fora não escapa. Para arquivo a ser CRIADO (ainda não existe),
// resolve a pasta-pai real + basename.
const { isBlockedPath } = require('./path-safety')
function isPathSafe(filePath) {
  let resolved = path.resolve(filePath)
  try {
    resolved = fs.realpathSync(resolved)
  } catch (e) {
    // não existe ainda (write/edit de arquivo novo): resolve o pai real.
    try { resolved = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved)) }
    catch (e2) { /* pai também não existe — usa o resolved literal */ }
  }
  return !isBlockedPath(resolved, os.homedir(), process.platform)
}

const CONVERSATIONS_PATH = path.join(app.getPath('userData'), 'conversations.json')
const ANALYTICS_PATH = path.join(app.getPath('userData'), 'analytics.json')
const AUDIT_LOG_PATH = path.join(app.getPath('userData'), 'audit-log.json')
// Dev Insights — privacy-safe usage telemetry (events + metadata only).
// The digest is the small, pre-aggregated file the maintainer reads each cycle.
const DEV_INSIGHTS_PATH = path.join(app.getPath('userData'), 'dev-insights.json')
const DEV_INSIGHTS_DIGEST_PATH = path.join(app.getPath('userData'), 'dev-insights-digest.json')
const DEV_INSIGHTS_CAP = 5000
// Relatórios .md POR CONVERSA (continuidade anti-refazer, v2.85.0) — um arquivo
// por conversa, vinculado pelo id; apagado junto com a conversa; nunca lido por
// outra conversa.
const REPORTS_DIR = path.join(app.getPath('userData'), 'reports')
function reportPath(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  return path.join(REPORTS_DIR, `${safe || 'sem-id'}.md`)
}
const DEV_INSIGHTS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// ─── Analytics Engine (MCD + MASA) ──────────────────────────────────
// Silent data collection + secure local storage with auto-purge
function loadAnalytics() {
  try {
    if (fs.existsSync(ANALYTICS_PATH)) {
      return JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load analytics:', e)
  }
  return { sessions: [], globalStats: { totalSessions: 0, totalToolCalls: 0, totalErrors: 0, totalAgentRuns: 0, totalCircuitBreaks: 0 } }
}

function saveAnalytics(data) {
  try {
    // Auto-purge: remove sessions older than 30 days (MASA requirement)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
    if (data.sessions) {
      data.sessions = data.sessions.filter(s => s.timestamp > thirtyDaysAgo)
    }
    // Keep max 500 sessions to prevent unbounded growth
    if (data.sessions && data.sessions.length > 500) {
      data.sessions = data.sessions.slice(-500)
    }
    atomicWriteJSON(ANALYTICS_PATH, data)
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Conversations persistence ───────────────────────────────────────
function loadConversations() {
  // Falls back to the .bak rotation if the primary file is ever missing or
  // corrupt, so a bad shutdown can't wipe the user's whole history.
  return readJSONWithFallback(CONVERSATIONS_PATH, [])
}

function saveConversations(data) {
  try {
    atomicWriteJSON(CONVERSATIONS_PATH, data)
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
}

// ─── System Tray ─────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../public/icon.png')
  let trayIcon
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } catch (e) {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('OpenClaude Desktop')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir', click: () => { if (win) { win.show(); win.focus() } } },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (win) { win.show(); win.focus() }
  })
}

// ─── Window ──────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Minimize to tray instead of closing
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  // ─── Menu de contexto + correção ortográfica ─────────────────
  // O Chromium SUBLINHA a palavra errada, mas o menu com as sugestões não
  // vem de fábrica no Electron: sem este handler o botão direito não faz
  // nada e o usuário vê o erro sem ter como aceitar uma correção. (Hover/
  // clique esquerdo não mostram sugestão em navegador nenhum — o padrão da
  // plataforma é botão direito.)
  win.webContents.session.setSpellCheckerLanguages(['pt-BR', 'en-US'])
  win.webContents.on('context-menu', (_e, params) => {
    const items = []
    if (params.misspelledWord) {
      const suggestions = (params.dictionarySuggestions || []).slice(0, 6)
      for (const s of suggestions) {
        items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) })
      }
      if (!suggestions.length) items.push({ label: '(sem sugestões)', enabled: false })
      items.push({ type: 'separator' })
      items.push({
        label: `Adicionar "${params.misspelledWord}" ao dicionário`,
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      })
    }
    if (params.isEditable) {
      if (items.length) items.push({ type: 'separator' })
      items.push({ role: 'cut', label: 'Recortar', enabled: params.editFlags.canCut })
      items.push({ role: 'copy', label: 'Copiar', enabled: params.editFlags.canCopy })
      items.push({ role: 'paste', label: 'Colar', enabled: params.editFlags.canPaste })
      items.push({ role: 'selectAll', label: 'Selecionar tudo' })
    } else if (params.selectionText && params.selectionText.trim()) {
      if (items.length) items.push({ type: 'separator' })
      items.push({ role: 'copy', label: 'Copiar' })
    }
    if (items.length) Menu.buildFromTemplate(items).popup()
  })

  // ─── Window controls ────────────────────────────────────────
  ipcMain.handle('window-minimize', () => win.minimize())
  ipcMain.handle('window-maximize', () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window-close', () => win.hide())
  ipcMain.handle('window-is-maximized', () => win.isMaximized())
}

// ─── IPC: Context Compaction ─────────────────────────────────────────
// Toda a compactação (incl. Ollama) agora roda no RENDERER via
// services/compaction.ts, que monta o resumo ESTRUTURADO (seções + tools +
// instruções do /compact) e roteia pelo IPC do provider real (provider-chat
// p/ nuvem, ollama-chat p/ local). O antigo handler 'compact-context' dedicado
// ao Ollama usava um prompt plano que descartava tools/instruções e ficou para
// trás no resumo estruturado (v2.59.0) — removido para não divergir.

// ─── IPC: Ollama chat (non-streaming) ────────────────────────────────
ipcMain.handle('ollama-chat', async (event, { messages, model, tools, temperature, max_tokens, numCtx, reasoningEffort, timeoutMs, toolChoice }) => {
  return new Promise((resolve, reject) => {
    const bodyObj = {
      model,
      messages,
      tools: tools || [],
      stream: false,
      options: { temperature: temperature ?? 0.7, ...(numCtx ? { num_ctx: numCtx } : {}) },
      ...(max_tokens ? { max_tokens } : {})
    }
    applyReasoning(bodyObj, 'ollama', model, reasoningEffort) // think on/off (v2.25.0)
    if (toolChoice && bodyObj.tools && bodyObj.tools.length) bodyObj.tool_choice = toolChoice // forçar/proibir ferramenta (v2.141.0)
    const body = JSON.stringify(bodyObj)

    const options = {
      hostname: 'localhost',
      port: 11434,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }

    // Timeout ABSOLUTO (v2.65.1): sem isto, se o Ollama aceita a conexão mas
    // trava (modelo carregando, geração presa), a Promise NUNCA resolve nem
    // rejeita — congelava o turno inteiro (e os subagentes, que rodam aqui).
    // Os workers passam um limite por-passo; o chat principal usa o default.
    let settled = false
    let timer = null
    // timeoutMs ausente → default 300s; <= 0 → SEM timeout (rede de segurança
    // opcional, v2.66.0 — o usuário pode desligar p/ tarefas longas).
    const TIMEOUT = (timeoutMs == null) ? 300000 : timeoutMs
    const finish = (fn, v) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); fn(v) }

    const req = http.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD na fronteira de pacote)
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        activeOllamaStream = null
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode && res.statusCode >= 400) {
            finish(resolve, { error: parsed.error || `Ollama HTTP ${res.statusCode}` })
          } else {
            finish(resolve, parsed)
          }
        }
        catch (e) { finish(resolve, { error: `Ollama response parse error: ${e.message}` }) }
      })
    })
    req.on('error', (err) => { activeOllamaStream = null; finish(reject, err) })
    if (TIMEOUT > 0) {
      timer = setTimeout(() => {
        try { req.destroy() } catch { /* já fechado */ }
        activeOllamaStream = null
        finish(resolve, { error: `Ollama timeout após ${Math.round(TIMEOUT / 1000)}s — o modelo "${model}" pode estar carregando ou travado (rode "ollama run ${model}" uma vez para pré-carregar).` })
      }, TIMEOUT)
    }
    activeOllamaStream = req
    req.write(body)
    req.end()
  })
})

// ─── IPC: Ollama chat streaming ──────────────────────────────────────
ipcMain.handle('ollama-chat-stream', async (event, { messages, model, tools, temperature, max_tokens, numCtx, reasoningEffort, toolChoice }) => {
  return new Promise((resolve, reject) => {
    const bodyObj = {
      model,
      messages,
      tools: tools || [],
      stream: true,
      // num_ctx ALOCA a janela de contexto no Ollama. Sem isto ele usa um
      // default pequeno e trunca em silêncio; com valor alto demais, processar
      // o contexto gigante num GPU de consumidor trava até dar timeout. O
      // renderer manda a janela REALISTA (settings.ollamaNumCtx). v2.24.0.
      options: { temperature: temperature ?? 0.7, ...(numCtx ? { num_ctx: numCtx } : {}) },
      ...(max_tokens ? { max_tokens } : {})
    }
    applyReasoning(bodyObj, 'ollama', model, reasoningEffort) // think on/off (v2.25.0)
    if (toolChoice && bodyObj.tools && bodyObj.tools.length) bodyObj.tool_choice = toolChoice // forçar/proibir ferramenta (v2.141.0)
    const body = JSON.stringify(bodyObj)

    const options = {
      hostname: 'localhost',
      port: 11434,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }

    let doneSent = false
    const sendDone = (error) => {
      if (doneSent) return
      doneSent = true
      activeOllamaStream = null
      try {
        event.sender.send('ollama-stream-chunk', { done: true, ...(error ? { error } : {}) })
      } catch (e) { console.error('[ollama-stream] sendDone error:', e) }
    }

    const req = http.request(options, (res) => {
      // Decode as UTF-8 with state across chunks — `chunk.toString()` corrupts
      // a multi-byte char (ã/ç/é…) that lands on a packet boundary into U+FFFD.
      res.setEncoding('utf8')
      // Check HTTP status for Ollama errors
      if (res.statusCode && res.statusCode >= 400) {
        let errorBody = ''
        res.on('data', (chunk) => { if (errorBody.length < 65536) errorBody += chunk.toString() })
        res.on('end', () => {
          let errMsg = `Ollama HTTP ${res.statusCode}`
          try { const parsed = JSON.parse(errorBody); errMsg = parsed.error || errMsg } catch (e) { /* non-JSON error body */ }
          sendDone(errMsg)
          resolve({ ok: false, error: errMsg })
        })
        return
      }

      let buffer = ''

      res.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const jsonStr = trimmed.slice(6)
          if (jsonStr === '[DONE]') {
            sendDone()
            continue
          }
          try {
            const parsed = JSON.parse(jsonStr)
            event.sender.send('ollama-stream-chunk', parsed)
          } catch (e) { console.error('[ollama-stream] SSE parse error:', e.message) }
        }
      })

      res.on('end', () => {
        if (buffer.trim()) {
          const trimmed = buffer.trim()
          if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
            try {
              const parsed = JSON.parse(trimmed.slice(6))
              event.sender.send('ollama-stream-chunk', parsed)
            } catch (e) { console.error('[ollama-stream] residual parse error:', e.message) }
          }
        }
        sendDone()
        resolve({ ok: true })
      })
    })

    req.on('error', (err) => {
      sendDone(err.message)
      resolve({ ok: false, error: err.message })
    })

    req.setTimeout(120000, () => { req.destroy(); sendDone('Ollama request timeout after 120s') })
    activeOllamaStream = req
    req.write(body)
    req.end()
  })
})

// ─── IPC: Abort stream (kills HTTP request, frees GPU) ──────────────
ipcMain.handle('abort-stream', async () => {
  let aborted = false
  if (activeOllamaStream) {
    activeOllamaStream.destroy()
    activeOllamaStream = null
    aborted = true
  }
  if (activeProviderStream) {
    activeProviderStream.destroy()
    activeProviderStream = null
    aborted = true
  }
  return { aborted }
})

// ─── IPC: Execute command ────────────────────────────────────────────
// Accepts a plain string (legacy callers) or { command, cwd, timeoutMs }.
// `cwd` runs the command inside a project's working folder; `timeoutMs`
// (model-requested via the timeout_s tool arg, re-clamped here as defense
// in depth) lifts the old fixed 60s wall for builds/installs/backtests.

// Commands currently in flight, so the agent Stop button (kill-commands) and
// the timeout can kill the whole process TREE. Node's built-in `timeout`
// option + child.kill() only hit the powershell.exe parent, leaving the
// grandchildren it spawned (MT5 terminal64.exe, python backtest.py, npm,
// compilers) orphaned and running on Windows.
const activeCommands = new Set()

function killProcessTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      // /T kills the whole subtree, /F forces. Fire-and-forget.
      exec(`taskkill /pid ${pid} /T /F`, { windowsHide: true }, () => {})
    } else {
      try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
    }
  } catch (e) { /* already exited */ }
}

ipcMain.handle('exec-command', async (event, payload) => {
  const { command, cwd, timeoutMs, env } = typeof payload === 'string'
    ? { command: payload, cwd: undefined, timeoutMs: undefined, env: undefined }
    : (payload || {})
  const timeout = Math.min(Math.max(Number(timeoutMs) || 60000, 1000), 600000)
  if (cwd && !fs.existsSync(cwd)) {
    return { stdout: '', stderr: '', exitCode: 1, timedOut: false, timeoutMs: timeout, error: `Pasta de trabalho não existe: ${cwd}` }
  }
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let killedByUser = false
    let timer = null
    const entry = {}
    const finish = (err, stdout, stderr) => {
      if (timer) clearTimeout(timer)
      activeCommands.delete(entry)
      if (settled) return
      settled = true
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        // err.code is the exit code on failure, but a string (ENOENT…) on
        // spawn errors and absent on a kill — normalize to a number.
        exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        timedOut,
        killedByUser,
        timeoutMs: timeout,
        error: err && !stdout && !stderr
          ? (killedByUser ? 'Comando interrompido pelo usuário' : err.message)
          : null
      })
    }
    // Roda PowerShell -NoProfile -NonInteractive -Command (v2.189.0), igual ao
    // handler de background. Sem -NonInteractive, qualquer prompt do PowerShell
    // (confirmação de cmdlet, Read-Host, credencial, ou um $PROFILE travado) fica
    // esperando input PARA SEMPRE → o comando "não termina" e só morre no timeout.
    // Com -NonInteractive ele FALHA RÁPIDO com erro claro em vez de travar; e
    // -NoProfile evita que o profile do usuário atrase/altere a execução.
    // execFile (não exec) p/ passar o comando como UM argumento de -Command —
    // sem reparse por shell. No built-in `timeout`: o timer manual + killProcessTree
    // derruba a subárvore inteira.
    const child = execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        cwd: cwd || undefined,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        windowsHide: true,
        // env extra (ex.: hooks PreToolUse recebem OPENCLAUDE_TOOL_NAME/ARGS).
        // Sanitizado (v2.114.0): chaves de hijack (PATH/NODE_OPTIONS/LD_PRELOAD…)
        // são barradas; valores limitados. Ver electron/exec-env.js.
        ...((() => { const safe = sanitizeChildEnv(env); return safe ? { env: { ...process.env, ...safe } } : {} })())
      }, finish)
    entry.child = child
    entry.markUser = () => { killedByUser = true }
    activeCommands.add(entry)
    timer = setTimeout(() => { timedOut = true; killProcessTree(child.pid) }, timeout)
  })
})

// Kill every execute_command in flight (wired to the agent Stop button). Tree
// kill so the grandchildren (MT5/python/builds) don't survive the Stop.
ipcMain.handle('kill-commands', async () => {
  let killed = 0
  for (const entry of activeCommands) {
    entry.markUser?.()
    killProcessTree(entry.child?.pid)
    killed++
  }
  return { killed }
})

// ─── IPC: Background commands (paridade com Bash run_in_background) ──
// Diferente do exec-command (síncrono, a IA espera), estes DISPARAM e seguem
// rodando entre passos/turnos: a IA inicia, continua trabalhando, consulta a
// saída INCREMENTAL e mata quando quiser. Buffer capado (não cresce sem limite);
// órfãos mortos no quit. Usa spawn (sem maxBuffer, ao contrário do exec).
const bgCommands = new Map() // id -> { child, command, stdout, stderr, done, exitCode, killedByUser, startedAt, doneAt }
let bgSeq = 0
const BG_BUF_CAP = 60000 // últimos ~60KB por stream entre consultas
const BG_DONE_TTL = 5 * 60 * 1000 // entrada CONCLUÍDA e não mais consultada expira em 5min

// Limpa entradas que já terminaram e a IA nunca mais consultou (senão o Map
// retém o child encerrado + buffers indefinidamente). O command-output já apaga
// a entrada na 1ª consulta pós-término; isto pega só as órfãs. Chamado nos
// handlers (sem timer de fundo).
function reapBgCommands() {
  const now = Date.now()
  for (const [id, e] of bgCommands) {
    if (e.done && e.doneAt && now - e.doneAt > BG_DONE_TTL) bgCommands.delete(id)
  }
}

ipcMain.handle('start-background-command', async (event, { command, cwd } = {}) => {
  if (!command || typeof command !== 'string') return { error: 'comando vazio' }
  if (cwd && !fs.existsSync(cwd)) return { error: `Pasta de trabalho não existe: ${cwd}` }
  reapBgCommands() // poda órfãs concluídas antes de criar mais uma
  const id = `bg${++bgSeq}`
  try {
    const { spawn } = require('child_process')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: cwd || undefined, windowsHide: true,
    })
    const entry = { child, command, stdout: '', stderr: '', done: false, exitCode: null, killedByUser: false, startedAt: Date.now() }
    if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', d => { entry.stdout = (entry.stdout + d).slice(-BG_BUF_CAP) }) }
    if (child.stderr) { child.stderr.setEncoding('utf8'); child.stderr.on('data', d => { entry.stderr = (entry.stderr + d).slice(-BG_BUF_CAP) }) }
    child.on('error', (e) => { entry.done = true; entry.doneAt = Date.now(); if (entry.exitCode == null) entry.exitCode = 1; entry.stderr = (entry.stderr + `\n[erro de spawn: ${e.message}]`).slice(-BG_BUF_CAP) })
    child.on('close', (code) => { entry.done = true; entry.doneAt = Date.now(); if (entry.exitCode == null) entry.exitCode = code })
    bgCommands.set(id, entry)
    return { id, pid: child.pid, error: null }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('command-output', async (event, { id } = {}) => {
  reapBgCommands() // poda órfãs concluídas a cada consulta
  const e = bgCommands.get(id)
  if (!e) return { found: false }
  // Return-and-clear: devolve só a saída NOVA desde a última consulta (estilo BashOutput).
  const stdout = e.stdout, stderr = e.stderr
  e.stdout = ''; e.stderr = ''
  const res = { found: true, running: !e.done, exitCode: e.exitCode, killedByUser: e.killedByUser, stdout, stderr, elapsedMs: Date.now() - e.startedAt }
  if (e.done) bgCommands.delete(id) // concluído E saída final entregue → libera
  return res
})

ipcMain.handle('kill-background-command', async (event, { id } = {}) => {
  const e = bgCommands.get(id)
  if (!e) return { found: false }
  e.killedByUser = true
  killProcessTree(e.child?.pid)
  return { found: true, killed: true } // o próximo command-output reporta running:false e libera
})

// Mata órfãos de background no encerramento (não deixar processos vazando).
app.on('before-quit', () => {
  for (const e of bgCommands.values()) { try { killProcessTree(e.child?.pid) } catch { /* já saiu */ } }
  // Servidores MCP também (v2.121.0): antes ficavam órfãos no quit.
  for (const c of mcpConnections.values()) { try { c.proc.kill() } catch { /* já saiu */ } }
})

// ─── IPC: Git command (sandboxed to git only) ──────────────────────
ipcMain.handle('git-command', async (event, { command, cwd }) => {
  return new Promise((resolve) => {
    // Security: only allow git subcommands, no pipes/chains
    if (/[;&|`$]/.test(command)) {
      return resolve({ stdout: '', stderr: '', error: 'Invalid characters in git command' })
    }
    exec(`git ${command}`, {
      cwd: cwd || undefined,
      shell: 'powershell.exe',
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        error: err && !stdout && !stderr ? err.message : null
      })
    })
  })
})

// ─── IPC: Read file ──────────────────────────────────────────────────
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    if (!isPathSafe(filePath)) {
      return { content: null, error: 'Access denied: path is in a protected directory' }
    }
    return { content: fs.readFileSync(filePath, 'utf-8'), error: null }
  } catch (e) {
    return { content: null, error: e.message }
  }
})

// ─── IPC: Write file (with auto-snapshot for undo) ──────────────────
const SNAPSHOTS_DIR = path.join(app.getPath('userData'), 'snapshots')
const fileSnapshots = [] // Stack: [{filePath, backupPath, created, seq, timestamp}]
let snapshotSeq = 0      // monotônico — âncora dos checkpoints (rewind por turno)

// Back up a file before overwriting so undo_last_write / checkpoint-restore can
// restore it. Shared by write-file and edit-file. Para arquivo NOVO (não existe
// ainda) grava um marcador `created` — assim o rewind sabe APAGÁ-LO ao reverter.
function snapshotFile(filePath) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
  const seq = ++snapshotSeq
  if (!fs.existsSync(filePath)) {
    fileSnapshots.push({ filePath, backupPath: null, created: true, seq, timestamp: Date.now() })
  } else {
    const backupName = `${Date.now()}_${path.basename(filePath)}`
    const backupPath = path.join(SNAPSHOTS_DIR, backupName)
    fs.copyFileSync(filePath, backupPath)
    fileSnapshots.push({ filePath, backupPath, created: false, seq, timestamp: Date.now() })
  }
  while (fileSnapshots.length > 50) {
    const old = fileSnapshots.shift()
    if (old.backupPath) { try { fs.unlinkSync(old.backupPath) } catch (e) { /* best-effort cleanup */ } }
  }
}

// Restaura UM snapshot (pop já feito pelo chamador): arquivo criado → apaga;
// arquivo modificado → repõe do backup. Devolve { filePath, error? }.
function restoreSnapshot(snap) {
  try {
    if (snap.created) {
      if (fs.existsSync(snap.filePath)) fs.unlinkSync(snap.filePath)
    } else {
      fs.copyFileSync(snap.backupPath, snap.filePath)
      try { fs.unlinkSync(snap.backupPath) } catch (e) { /* best-effort */ }
    }
    return { filePath: snap.filePath }
  } catch (e) {
    return { filePath: snap.filePath, error: e.message }
  }
}

ipcMain.handle('write-file', async (event, { filePath, content, append, appendIfExists }) => {
  try {
    if (!isPathSafe(filePath)) {
      return { error: 'Access denied: path is in a protected directory' }
    }
    // `existed` alimenta o coaching de edit_file no renderer: reescrever um
    // arquivo existente inteiro é o anti-padrão que os Dev Insights flagram
    // (write_file de 13 min no Modal/GLM enquanto edit_file tinha 0 usos).
    const existed = fs.existsSync(filePath)
    snapshotFile(filePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    // append (v2.161.0): escrever arquivo grande em pedaços sem estourar o limite
    // de tokens. appendIfExists = recuperação de escrita truncada: anexa só se o
    // arquivo já existe (continuação de um build), senão cria.
    const doAppend = append === true || (appendIfExists === true && existed)
    if (doAppend) fs.appendFileSync(filePath, String(content ?? ''), 'utf-8')
    else fs.writeFileSync(filePath, content, 'utf-8')
    return { error: null, existed, appended: doAppend, bytes: Buffer.byteLength(String(content ?? ''), 'utf-8') }
  } catch (e) {
    return { error: e.message }
  }
})

// ─── IPC: Edit file (surgical old_string → new_string, unique match) ──
// Lets a non-frontier model change part of a large file without regenerating
// it whole. Reuses the same snapshot/undo as write-file.
ipcMain.handle('edit-file', async (event, { filePath, oldString, newString, replaceAll }) => {
  try {
    if (!isPathSafe(filePath)) {
      return { error: 'Access denied: path is in a protected directory' }
    }
    if (!fs.existsSync(filePath)) {
      return { error: 'file_not_found' }
    }
    if (typeof oldString !== 'string' || oldString.length === 0) {
      return { error: 'empty_old_string' }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    // split/join does literal replacement (no regex escaping) and gives the
    // occurrence count for free.
    const parts = content.split(oldString)
    const occurrences = parts.length - 1
    if (occurrences === 0) return { error: 'not_found', occurrences: 0 }
    // replaceAll (estilo Edit do Claude Code, v2.82.0): com replaceAll, a
    // ambiguidade é INTENCIONAL — substitui todas; sem ele, mantém a exigência
    // de match único (segurança contra edição acidental no lugar errado).
    if (occurrences > 1 && !replaceAll) return { error: 'ambiguous', occurrences }
    snapshotFile(filePath)
    fs.writeFileSync(filePath, parts.join(newString ?? ''), 'utf-8')
    return { error: null, replaced: true, occurrences }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('undo-last-write', async () => {
  if (fileSnapshots.length === 0) {
    return { error: 'No snapshots available', restored: null }
  }
  const r = restoreSnapshot(fileSnapshots.pop())
  return r.error ? { error: r.error, restored: null } : { error: null, restored: r.filePath }
})

// ─── IPC: Checkpoint / rewind (reverter alterações de um turno) ──────
// Um checkpoint é só a marca do `snapshotSeq` no início do turno. Reverter =
// restaurar (LIFO) todos os snapshots com seq > marca: como cada backup é o
// pre-image daquela escrita, desfazer do mais novo ao mais antigo caminha o
// estado de volta ao início do turno. Inspirado no rewind do Claude Code.
ipcMain.handle('checkpoint-mark', async () => ({ seq: snapshotSeq }))

// Quantos arquivos DISTINTOS mudaram desde a marca (para a UI decidir oferecer
// o "Reverter").
ipcMain.handle('checkpoint-count', async (event, { seq } = {}) => {
  const since = typeof seq === 'number' ? seq : 0
  const files = new Set(fileSnapshots.filter(s => s.seq > since).map(s => s.filePath))
  return { count: files.size }
})

ipcMain.handle('checkpoint-restore', async (event, { seq } = {}) => {
  const since = typeof seq === 'number' ? seq : 0
  const restored = new Set()
  const errors = []
  while (fileSnapshots.length > 0 && fileSnapshots[fileSnapshots.length - 1].seq > since) {
    const r = restoreSnapshot(fileSnapshots.pop())
    if (r.error) errors.push(r.error); else restored.add(r.filePath)
  }
  return { restored: [...restored], count: restored.size, errors }
})

ipcMain.handle('list-snapshots', async () => {
  return fileSnapshots.map(s => ({
    filePath: s.filePath,
    timestamp: s.timestamp,
    fileName: path.basename(s.filePath)
  }))
})

// ─── IPC: List models ────────────────────────────────────────────────
ipcMain.handle('list-models', async () => {
  return new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port: 11434, path: '/api/tags', method: 'GET' }, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD na fronteira de pacote)
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve({ models: [] }) }
      })
    })
    req.on('error', () => resolve({ models: [] }))
    req.end()
  })
})

// ─── IPC: Conversations persistence ──────────────────────────────────
ipcMain.handle('save-conversations', async (event, data) => {
  return saveConversations(data)
})

ipcMain.handle('load-conversations', async () => {
  return loadConversations()
})

// ─── IPC: Dev Insights (privacy-safe usage telemetry) ────────────────
ipcMain.handle('dev-insights-flush', async (event, payload) => {
  try {
    const events = Array.isArray(payload?.events) ? payload.events : []
    const existing = readJSONWithFallback(DEV_INSIGHTS_PATH, [])
    const now = Date.now()
    let merged = (Array.isArray(existing) ? existing : []).concat(events)
    // Auto-purge old events, then cap to the most recent N.
    merged = merged.filter(e => e && typeof e.t === 'number' && (now - e.t) <= DEV_INSIGHTS_MAX_AGE_MS)
    if (merged.length > DEV_INSIGHTS_CAP) merged = merged.slice(-DEV_INSIGHTS_CAP)
    atomicWriteJSON(DEV_INSIGHTS_PATH, merged)
    if (payload?.digest) atomicWriteJSON(DEV_INSIGHTS_DIGEST_PATH, payload.digest)
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('dev-insights-load', async () => readJSONWithFallback(DEV_INSIGHTS_PATH, []))

ipcMain.handle('dev-insights-clear', async () => {
  try {
    atomicWriteJSON(DEV_INSIGHTS_PATH, [])
    atomicWriteJSON(DEV_INSIGHTS_DIGEST_PATH, {})
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
})

// ─── IPC: Relatório .md por conversa (continuidade, v2.85.0) ────────
ipcMain.handle('report-load', async (event, { id } = {}) => {
  try {
    const p = reportPath(id)
    return { content: fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '', error: null }
  } catch (e) { return { content: '', error: e.message } }
})
ipcMain.handle('report-save', async (event, { id, content } = {}) => {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true })
    const p = reportPath(id)
    // tmp + rename → escrita atômica (uma escrita rasgada não corrompe o relatório).
    const tmp = p + '.tmp'
    fs.writeFileSync(tmp, String(content ?? ''), 'utf-8')
    fs.renameSync(tmp, p)
    return { error: null }
  } catch (e) { return { error: e.message } }
})
ipcMain.handle('report-delete', async (event, { id } = {}) => {
  try {
    const p = reportPath(id)
    if (fs.existsSync(p)) fs.unlinkSync(p)
    return { error: null }
  } catch (e) { return { error: e.message } }
})

// ─── IPC: Web search (DuckDuckGo HTML scraping) ─────────────────────
// Turbocharged (v2.12.41 — web_search is the #1 tool): results are de-duped by
// normalized URL, formatted as citation-ready markdown (clickable in the chat),
// and cached briefly so an agentic loop refining the same query doesn't re-scrape.
const WEB_SEARCH_CACHE = new Map() // cacheKey → { result, ts }
const WEB_SEARCH_TTL_MS = 5 * 60 * 1000 // 5 min
const WEB_SEARCH_CACHE_MAX = 50

ipcMain.handle('web-search', async (event, query) => {
  // Cache hit: an identical query within the TTL returns instantly (no re-scrape).
  const key = cacheKey(query)
  const cached = WEB_SEARCH_CACHE.get(key)
  if (isFresh(cached, Date.now(), WEB_SEARCH_TTL_MS)) {
    return { result: cached.result, error: null, cached: true }
  }

  return new Promise((resolve) => {
    const encodedQuery = encodeURIComponent(query)
    const options = {
      hostname: 'html.duckduckgo.com',
      path: `/html/?q=${encodedQuery}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      }
    }
    let data = ''
    // Every other HTTP path in this file has a timeout; web_search didn't, so
    // a slow / half-open DuckDuckGo socket could hang the tool call forever —
    // feeding the user's #1 error (timeout) on the 3rd most-used tool.
    const WEB_SEARCH_TIMEOUT_MS = 15000
    const req = https.request(options, (res) => {
      // Follow redirects — drain the original response body (res.resume())
      // so the socket can be freed instead of lingering half-open.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const r2req = https.get(res.headers.location, { headers: options.headers }, (r2) => {
          let rd = ''
          r2.setEncoding('utf8')
          r2.on('data', c => rd += c)
          r2.on('end', () => parseAndResolve(rd))
        })
        r2req.on('error', (e) => resolve({ result: null, error: e.message }))
        r2req.setTimeout(WEB_SEARCH_TIMEOUT_MS, () => { r2req.destroy(); resolve({ result: null, error: 'web search timeout' }) })
        return
      }
      res.setEncoding('utf8') // UTF-8 estável entre chunks (HTML pt-BR do DuckDuckGo)
      res.on('data', chunk => data += chunk)
      res.on('end', () => parseAndResolve(data))
    })
    req.on('error', (e) => resolve({ result: null, error: e.message }))
    req.setTimeout(WEB_SEARCH_TIMEOUT_MS, () => { req.destroy(); resolve({ result: null, error: 'web search timeout' }) })
    req.end()

    function parseAndResolve(html) {
      const results = []
      // Extract result links and snippets from DuckDuckGo HTML
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      let match
      while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
        const url = decodeURIComponent(match[1].replace(/.*uddg=/, '').replace(/&.*/, ''))
        const title = match[2].replace(/<[^>]*>/g, '').trim()
        if (title && url && !url.includes('duckduckgo.com')) {
          results.push({ title, url })
        }
      }
      // Try to get snippets
      let idx = 0
      while ((match = snippetRegex.exec(html)) !== null && idx < results.length) {
        results[idx].snippet = match[1].replace(/<[^>]*>/g, '').trim()
        idx++
      }
      if (results.length > 0) {
        const deduped = dedupeResults(results)
        const result = formatResults(query, deduped)
        // Cache the formatted result (evict oldest when over the cap).
        WEB_SEARCH_CACHE.set(key, { result, ts: Date.now() })
        if (WEB_SEARCH_CACHE.size > WEB_SEARCH_CACHE_MAX) {
          WEB_SEARCH_CACHE.delete(WEB_SEARCH_CACHE.keys().next().value)
        }
        resolve({ result, error: null })
      } else {
        // Fallback to instant answer API
        const fbReq = https.get(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1`, (res2) => {
          let d = ''
          res2.setEncoding('utf8')
          res2.on('data', c => d += c)
          res2.on('end', () => {
            try {
              const r = JSON.parse(d)
              let text = ''
              if (r.AbstractText) text += r.AbstractText + '\n'
              if (r.AbstractURL) text += `Fonte: ${r.AbstractURL}\n`
              if (r.RelatedTopics) {
                for (const t of r.RelatedTopics.slice(0, 5)) {
                  if (t.Text) text += `- ${t.Text}\n`
                }
              }
              resolve({ result: text || `Sem resultados para "${query}".`, error: null })
            } catch { resolve({ result: `Sem resultados para "${query}".`, error: null }) }
          })
        })
        fbReq.on('error', () => resolve({ result: `Sem resultados para "${query}".`, error: null }))
        fbReq.setTimeout(WEB_SEARCH_TIMEOUT_MS, () => { fbReq.destroy(); resolve({ result: `Sem resultados para "${query}".`, error: null }) })
      }
    }
  })
})

// ─── IPC: Fetch URL (estilo WebFetch — ler página SEM abrir navegador) ───
// HTTP GET puro + extração de texto (web-fetch-util). É o caminho padrão para
// LER/varrer uma página: rápido e, ao contrário do browser, não abre janela.
// O modelo só cai para browser_navigate quando precisa de JS/interação (sinal
// `thin: true`) ou de clicar/preencher/screenshot.
const FETCH_CACHE = new Map() // url → { result, ts }
const FETCH_CACHE_TTL_MS = 5 * 60 * 1000
const FETCH_CACHE_MAX = 50

ipcMain.handle('fetch-url', async (event, url) => {
  if (!url || typeof url !== 'string') return { error: 'Invalid URL' }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  // Cache curto (como web_search): reler a mesma URL entre passos é instantâneo
  // e não dispara o circuit breaker de chamadas repetidas.
  const cached = FETCH_CACHE.get(url)
  if (isFresh(cached, Date.now(), FETCH_CACHE_TTL_MS)) {
    return { ...cached.result, cached: true }
  }
  const FETCH_TIMEOUT_MS = 15000
  const MAX_BYTES = 2_000_000
  const MAX_TEXT = BROWSER_CONFIG.MAX_TEXT_LENGTH
  const headers = {
    'User-Agent': BROWSER_CONFIG.USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  }
  return new Promise((resolve) => {
    let redirects = 0
    let done = false
    const finish = (obj) => { if (!done) { done = true; resolve(obj) } }
    // Guard SSRF (v2.113.0): valida o host (literal) e resolve o DNS antes de
    // CADA request — revalida em redirect, defeitando redirect→localhost. Os
    // classificadores puros vivem em electron/ssrf-guard.js.
    const get = (u) => {
      let host
      try { host = new URL(u).hostname } catch { return finish({ error: 'Invalid URL' }) }
      const litReason = hostnameBlockReason(host)
      if (litReason) return finish({ error: `URL recusada por segurança (SSRF: ${litReason}) — destinos locais/privados são bloqueados.` })
      dns.lookup(host, (err, address) => {
        if (err) return finish({ error: `DNS falhou para "${host}": ${err.message}` })
        const ipReason = ipToBlockReason(address)
        if (ipReason) return finish({ error: `URL recusada por segurança (SSRF: o host resolve para um IP ${ipReason}).` })
        doRequest(u)
      })
    }
    const doRequest = (u) => {
      let lib
      try { lib = u.startsWith('http://') ? http : https } catch { return finish({ error: 'Invalid URL' }) }
      const req = lib.get(u, { headers }, (res) => {
        // Follow redirects (cap 5) — drain body so the socket is freed.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (++redirects > 5) return finish({ error: 'Too many redirects' })
          let next
          try { next = new URL(res.headers.location, u).toString() } catch { return finish({ error: 'Bad redirect location' }) }
          return get(next)
        }
        const ctype = String(res.headers['content-type'] || '')
        if (ctype && !/text\/html|text\/plain|application\/(xhtml|xml|json)|\+xml/i.test(ctype)) {
          res.resume()
          return finish({ error: `Unsupported content-type "${ctype.split(';')[0].trim()}" — use browser_navigate or open_file_or_url`, url: u })
        }
        // Acumula BUFFERS e decodifica UTF-8 de uma vez só no fim. Fazer
        // c.toString('utf8') por chunk corrompe um caractere multibyte (ç/ã/é…)
        // que caia na fronteira de dois pacotes TCP (vira U+FFFD) — o mesmo
        // defeito que os streams de chat corrigem via setEncoding('utf8'). Crítico
        // aqui porque o conteúdo costuma ser português. bytes usa c.length (que
        // num Buffer é o nº de BYTES), mantendo o teto MAX_BYTES exato.
        const chunks = []
        let bytes = 0
        let truncatedBytes = false
        const decode = () => Buffer.concat(chunks).toString('utf8')
        res.on('data', (c) => {
          bytes += c.length
          if (bytes > MAX_BYTES) { truncatedBytes = true; try { req.destroy() } catch { /* ignore */ } return }
          chunks.push(c)
        })
        res.on('end', () => deliver(u, decode(), truncatedBytes))
        res.on('aborted', () => deliver(u, decode(), true))
      })
      req.on('error', (e) => finish({ error: e.message }))
      req.setTimeout(FETCH_TIMEOUT_MS, () => { try { req.destroy() } catch { /* ignore */ } finish({ error: 'fetch timeout' }) })
    }
    const deliver = (finalUrl, html, truncatedBytes) => {
      const title = extractTitle(html)
      let text = htmlToText(html)
      const truncated = truncatedBytes || text.length > MAX_TEXT
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT)
      const result = { success: true, url: finalUrl, title, text, thin: looksThin(text), truncated }
      // Guarda no cache (chaveado pela URL original pedida); evicta o mais antigo.
      FETCH_CACHE.set(url, { result, ts: Date.now() })
      if (FETCH_CACHE.size > FETCH_CACHE_MAX) FETCH_CACHE.delete(FETCH_CACHE.keys().next().value)
      finish(result)
    }
    get(url)
  })
})

// ─── IPC: List directory ─────────────────────────────────────────────
ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const items = entries.map(entry => {
      let size = 0
      let modified = ''
      try {
        const stats = fs.statSync(path.join(dirPath, entry.name))
        size = stats.size
        modified = stats.mtime.toISOString()
      } catch (e) { /* stat failed, use defaults */ }
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size,
        modified
      }
    })
    return { items, error: null }
  } catch (e) {
    return { items: null, error: e.message }
  }
})

// ─── IPC: Search files (grep-like content search) ───────────────────
// Lets the agent answer "where is X / which file defines Y" in ONE round-trip
// instead of error-prone Select-String (execute_command) or reading files one
// by one. Skips ignored dirs, binaries and large files; capped output.
const SEARCH_IGNORE = new Set(['node_modules', '.git', 'dist', 'release', 'build', '.cache', '__pycache__', 'out', 'coverage'])
ipcMain.handle('search-files', async (event, payload) => {
  const { query, path: searchPath, exts, maxResults, caseSensitive } = payload || {}
  if (!query || typeof query !== 'string') return { matches: [], error: 'query vazia' }
  const root = searchPath || process.cwd()
  if (!isPathSafe(root)) return { matches: [], error: 'Access denied: protected directory' }
  const cap = Math.min(Math.max(Number(maxResults) || 100, 1), 500)
  const needle = caseSensitive ? query : query.toLowerCase()
  const extList = Array.isArray(exts) && exts.length ? exts.map(e => String(e).toLowerCase()) : null
  const matches = []
  let filesScanned = 0
  let truncated = false

  function walk(dir, depth) {
    if (depth > 8 || matches.length >= cap) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (matches.length >= cap) { truncated = true; return }
      if (SEARCH_IGNORE.has(e.name) || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full, depth + 1); continue }
      if (extList && !extList.some(x => e.name.toLowerCase().endsWith(x))) continue
      let stat
      try { stat = fs.statSync(full) } catch { continue }
      if (stat.size > 2 * 1024 * 1024) continue // skip files > 2MB
      let content
      try { content = fs.readFileSync(full, 'utf-8') } catch { continue }
      if (content.includes('\u0000')) continue // looks binary
      filesScanned++
      const fileLines = content.split('\n')
      for (let i = 0; i < fileLines.length; i++) {
        const hay = caseSensitive ? fileLines[i] : fileLines[i].toLowerCase()
        if (hay.includes(needle)) {
          matches.push({ file: full, line: i + 1, text: fileLines[i].slice(0, 200).trim() })
          if (matches.length >= cap) { truncated = true; break }
        }
      }
    }
  }
  try {
    walk(root, 0)
    return { matches, filesScanned, truncated, error: null }
  } catch (e) {
    return { matches, error: e.message }
  }
})

// ─── IPC: Open file or URL ───────────────────────────────────────────
ipcMain.handle('open-target', async (event, target) => {
  try {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      await shell.openExternal(target)
    } else {
      await shell.openPath(target)
    }
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
})

// ─── IPC: Check Ollama status ────────────────────────────────────────
ipcMain.handle('check-ollama-status', async () => {
  return new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port: 11434, path: '/', method: 'GET', timeout: 3000 }, (res) => {
      resolve(true)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
})

// ─── IPC: Auto-start settings ────────────────────────────────────────
ipcMain.handle('get-auto-start', async () => {
  try {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  } catch { return false }
})

ipcMain.handle('set-auto-start', async (event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
})

// ─── IPC: Save dialog (for export) ──────────────────────────────────
ipcMain.handle('save-dialog', async (event, { defaultName, filters }) => {
  try {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'conversa.md',
      filters: filters || [{ name: 'Markdown', extensions: ['md'] }, { name: 'Todos os arquivos', extensions: ['*'] }]
    })
    if (result.canceled) return { filePath: null, error: null }
    return { filePath: result.filePath, error: null }
  } catch (e) {
    return { filePath: null, error: e.message }
  }
})

// ─── IPC: Folder picker (working directory, estilo Claude Code) ─────
// Seleciona a PASTA de trabalho da conversa — onde execute_command/
// run_command_background e ops de arquivo rodam por padrão (v2.84.0).
ipcMain.handle('open-folder-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Selecionar pasta de trabalho',
    })
    if (result.canceled || !result.filePaths.length) return { path: null, error: null }
    return { path: result.filePaths[0], error: null }
  } catch (e) {
    return { path: null, error: e.message }
  }
})

// ─── IPC: Backup / restore (full user data export/import) ────────────
// Additive: reads/writes the known userData JSON files. The renderer pairs
// this with the localStorage half (see utils/backup.ts). Never touches an
// existing flow, so it can't regress anything.
const BACKUP_FILES = [
  'conversations.json', 'memory.json', 'prompt-vault.json', 'rag-index.json',
  'personas.json', 'skills.json', 'workflows.json', 'arena-scores.json', 'agent-memory.json',
  'analytics.json', 'audit-log.json', 'dev-insights.json', 'dev-insights-digest.json',
]

ipcMain.handle('export-user-data', async () => {
  const files = {}
  for (const name of BACKUP_FILES) {
    try {
      const p = path.join(app.getPath('userData'), name)
      if (fs.existsSync(p)) files[name] = JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch (e) { /* skip unreadable/corrupt file — best effort */ }
  }
  return { files, error: null }
})

ipcMain.handle('import-user-data', async (event, payload) => {
  const files = (payload && payload.files) || {}
  let restored = 0
  try {
    for (const name of BACKUP_FILES) {
      if (Object.prototype.hasOwnProperty.call(files, name) && files[name] != null) {
        atomicWriteJSON(path.join(app.getPath('userData'), name), files[name])
        restored++
      }
    }
    return { restored, error: null }
  } catch (e) {
    return { restored, error: e.message }
  }
})

// ─── IPC: Read dropped file ──────────────────────────────────────────
ipcMain.handle('read-dropped-file', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath)
    if (stats.size > 5 * 1024 * 1024) {
      return { content: null, error: 'Arquivo muito grande (> 5MB)' }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return { content, name: path.basename(filePath), error: null }
  } catch (e) {
    return { content: null, error: e.message }
  }
})

// ─── IPC: Update Check ───────────────────────────────────────────────
ipcMain.handle('check-update', async () => {
  return new Promise((resolve) => {
    const defaultRepo = 'mrtjr/openclaude-desktop'
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${defaultRepo}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'OpenClaude-Desktop-Update-Checker'
      }
    }
    const https = require('https')
    const req = https.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD na fronteira de pacote)
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (res.statusCode === 200 && result.tag_name) {
            const currentVersion = app.getVersion()
            const latestVersion = result.tag_name.replace(/^v/, '')
            
            // Basic semantic version comparison (SemVer)
            const cmpVersions = (a, b) => {
              const pa = a.split('.').map(Number)
              const pb = b.split('.').map(Number)
              for (let i = 0; i < 3; i++) {
                if ((pa[i] || 0) > (pb[i] || 0)) return 1
                if ((pb[i] || 0) > (pa[i] || 0)) return -1
              }
              return 0
            }

            const isNewer = cmpVersions(latestVersion, currentVersion) > 0
            resolve({
              updateAvailable: isNewer,
              currentVersion,
              latestVersion,
              releaseUrl: result.html_url || `https://github.com/${defaultRepo}/releases/latest`
            })
          } else {
            resolve({ updateAvailable: false, error: 'Could not fetch latest release' })
          }
        } catch (e) {
          resolve({ updateAvailable: false, error: e.message })
        }
      })
    })
    req.on('error', (e) => resolve({ updateAvailable: false, error: e.message }))
    req.end()
  })
})

// Apply a downloaded auto-update: quit and relaunch on the new version.
ipcMain.handle('quit-and-install', () => quitAndInstall())

// ─── IPC: Memory system (persistent user memory) ────────────────────
const MEMORY_PATH = path.join(app.getPath('userData'), 'memory.json')

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_PATH)) {
      return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'))
    }
  } catch (e) { console.error('[memory] load error:', e) }
  return { facts: [], preferences: [], projects: [] }
}

function saveMemory(data) {
  try {
    atomicWriteJSON(MEMORY_PATH, data)
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
}

ipcMain.handle('load-memory', async () => loadMemory())
ipcMain.handle('save-memory', async (event, data) => saveMemory(data))

// ─── Helper: Parse a custom OpenAI-compatible base URL ──────────
// Accepts forms like:
//   https://api.groq.com/openai/v1
//   http://localhost:1234/v1          (LM Studio, llama.cpp)
//   https://my-proxy.example.com
// Returns: { protocol, hostname, port, basePath, transport }
function parseCustomBase(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return null
  try {
    const u = new URL(baseUrl)
    const isHttps = u.protocol === 'https:'
    return {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80),
      // Strip trailing slash; keep path prefix (e.g. "/openai/v1")
      basePath: u.pathname.replace(/\/+$/, ''),
      transport: isHttps ? https : http,
    }
  } catch { return null }
}

// ─── IPC: Multi-provider chat (OpenAI, Gemini, Anthropic) ──────────
ipcMain.handle('provider-chat', async (event, { provider, apiKey, model, messages, tools, temperature, max_tokens, stream, modalHostname, customBaseUrl, reasoningEffort, toolChoice }) => {
  return new Promise((resolve, reject) => {
    let hostname, apiPath, headers, bodyObj
    let transport = https
    let port

    if (provider === 'openai') {
      hostname = 'api.openai.com'
      apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      bodyObj = { model, messages, tools: tools || undefined, stream: false, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com'
      // Convert OpenAI messages to Gemini format (with tool call support)
      const geminiContents = messages.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'tool') {
          return { role: 'user', parts: [{ functionResponse: { name: m.name || 'tool', response: { content: m.content || '' } } }] }
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          return { role: 'model', parts: m.tool_calls.map(tc => ({ functionCall: { name: tc.function.name, args: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })() } })) }
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: toGeminiParts(m.content) }
      })
      const systemInstruction = messages.find(m => m.role === 'system')
      // Convert OpenAI tools to Gemini functionDeclarations
      const geminiTools = tools?.length ? [{ functionDeclarations: tools.map(t => ({ name: t.function.name, description: t.function.description || '', parameters: t.function.parameters })) }] : undefined
      apiPath = `/v1beta/models/${model}:generateContent?key=${apiKey}`
      headers = { 'Content-Type': 'application/json' }
      bodyObj = {
        contents: geminiContents,
        generationConfig: { temperature: temperature ?? 0.7, maxOutputTokens: max_tokens || 4096 },
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {}),
        ...(geminiTools ? { tools: geminiTools } : {})
      }
    } else if (provider === 'anthropic') {
      hostname = 'api.anthropic.com'
      apiPath = '/v1/messages'
      const systemMsg = messages.find(m => m.role === 'system')
      // Convert OpenAI message format to Anthropic format (with tool call support)
      const anthropicMsgs = []
      for (const m of messages.filter(msg => msg.role !== 'system')) {
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const content = []
          if (m.content) content.push({ type: 'text', text: m.content })
          for (const tc of m.tool_calls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })() })
          }
          anthropicMsgs.push({ role: 'assistant', content })
        } else if (m.role === 'tool') {
          anthropicMsgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || '', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] })
        } else {
          anthropicMsgs.push({ role: m.role, content: toAnthropicContent(m.content) })
        }
      }
      // Convert OpenAI tools to Anthropic tools format
      const anthropicTools = tools?.length ? tools.map(t => ({ name: t.function.name, description: t.function.description || '', input_schema: t.function.parameters || { type: 'object', properties: {} } })) : undefined
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      bodyObj = {
        model,
        max_tokens: max_tokens || 4096,
        messages: anthropicMsgs,
        ...(systemMsg ? { system: cachedSystem(systemMsg.content) } : {}),
        // Opus 4.7/4.8/Fable 5 rejeitam temperature (400) — só envia onde é aceita.
        ...(anthropicAcceptsTemperature(model) ? { temperature: temperature ?? 0.7 } : {}),
        ...(anthropicTools ? { tools: withCachedTools(anthropicTools) } : {})
      }
    } else if (provider === 'openrouter') {
      hostname = 'openrouter.ai'
      apiPath = '/api/v1/chat/completions'
      headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/mrtjr/openclaude-desktop',
        'X-Title': 'OpenClaude Desktop'
      }
      bodyObj = { model, messages, tools: tools || undefined, stream: false, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'modal') {
      hostname = modalHostname || 'api.us-west-2.modal.direct'
      apiPath = '/v1/chat/completions'
      headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'OpenClaude-Desktop'
      }
      bodyObj = { model, messages, tools: tools || undefined, stream: false, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'custom') {
      const cfg = parseCustomBase(customBaseUrl)
      if (!cfg) return resolve({ error: 'Custom provider: invalid baseUrl' })
      hostname = cfg.hostname
      port = cfg.port
      transport = cfg.transport
      apiPath = `${cfg.basePath}/chat/completions`
      headers = { 'Content-Type': 'application/json', 'User-Agent': 'OpenClaude-Desktop' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      bodyObj = { model, messages, tools: tools || undefined, stream: false, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else {
      return resolve({ error: `Provider "${provider}" not supported` })
    }

    applyReasoning(bodyObj, provider, model, reasoningEffort)
    if (toolChoice && bodyObj.tools && bodyObj.tools.length) bodyObj.tool_choice = toolChoice // forçar/proibir ferramenta (v2.141.0)

    const body = JSON.stringify(bodyObj)
    const reqOptions = {
      hostname,
      ...(port ? { port } : {}),
      path: apiPath,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }

    const req = transport.request(reqOptions, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD na fronteira de pacote)
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) {
            return resolve({ error: `API error ${res.statusCode}: ${JSON.stringify(parsed)}` })
          }

          // Normalize response to OpenAI format
          if (provider === 'gemini') {
            const candidate = parsed.candidates?.[0]
            const parts = candidate?.content?.parts || []
            const functionCalls = parts.filter(p => p.functionCall)
            if (functionCalls.length > 0) {
              const tool_calls = functionCalls.map((p, i) => ({ id: `gemini_fc_${i}_${Date.now()}`, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }))
              resolve({ choices: [{ message: { role: 'assistant', content: null, tool_calls }, finish_reason: 'tool_calls' }] })
            } else {
              const text = parts.map(p => p.text || '').join('')
              resolve({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
            }
          } else if (provider === 'anthropic') {
            const content = parsed.content || []
            const textBlocks = content.filter(c => c.type === 'text')
            const toolUseBlocks = content.filter(c => c.type === 'tool_use')
            const text = textBlocks.map(c => c.text).join('')
            if (toolUseBlocks.length > 0) {
              const tool_calls = toolUseBlocks.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input || {}) } }))
              resolve({ choices: [{ message: { role: 'assistant', content: text || null, tool_calls }, finish_reason: 'tool_calls' }] })
            } else {
              resolve({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: parsed.stop_reason === 'end_turn' ? 'stop' : parsed.stop_reason }] })
            }
          } else {
            resolve(parsed)
          }
        } catch (e) { resolve({ error: e.message }) }
      })
    })
    req.on('error', (e) => resolve({ error: e.message }))
    // 'connect' budget covers Modal's GPU cold start (first byte). Non-stream
    // responses arrive in one shot, so there's no reliable intra-body cadence
    // to tighten against — keep the generous budget for the whole request.
    const reqTimeoutMs = providerTimeoutMs(provider, 'connect')
    req.setTimeout(reqTimeoutMs, () => { req.destroy(); resolve({ error: `Provider request timeout after ${reqTimeoutMs / 1000}s` }) })
    req.write(body)
    req.end()
  })
})

// Mescla os params de esforço de raciocínio no corpo do request (mutável).
// 'default'/ausente = no-op. Ver electron/reasoning-control.js. v2.25.0.
function applyReasoning(bodyObj, provider, model, effort) {
  const rp = reasoningRequestParams(provider, model, effort)
  if (rp.extra && Object.keys(rp.extra).length) Object.assign(bodyObj, rp.extra)
  if (rp.dropTemperature) delete bodyObj.temperature
  if (rp.minMaxTokens && (!bodyObj.max_tokens || bodyObj.max_tokens < rp.minMaxTokens)) bodyObj.max_tokens = rp.minMaxTokens
  return bodyObj
}

// ─── IPC: Multi-provider chat STREAMING (OpenAI/OpenRouter/Modal/Anthropic) ─
ipcMain.handle('provider-chat-stream', async (event, { provider, apiKey, model, messages, tools, temperature, max_tokens, modalHostname, customBaseUrl, reasoningEffort, toolChoice }) => {
  return new Promise((resolve) => {
    let hostname, apiPath, headers, bodyObj
    let transport = https
    let port

    // `stream_options.include_usage` makes OpenAI-compatible APIs emit a final
     // chunk with `usage: {prompt_tokens, completion_tokens, total_tokens}`.
     // Without this, cost tracking has to guess via heuristic. We only send it
     // for providers that understand it (OpenAI, OpenRouter, Modal, custom).
    const openaiStreamOpts = { include_usage: true }
    // Esses providers emitem um chunk FINAL com `usage` DEPOIS do chunk de
    // finish_reason (ordem do protocolo OpenAI/include_usage). Por isso NÃO
    // podemos sinalizar `done` ao ver finish_reason — o renderer faz cleanup()
    // no `done` e descartaria o chunk de usage que vem logo atrás (o custo real
    // do turno se perdia e caía no fallback heurístico). Para esses, encerramos
    // só no `[DONE]`/fim de resposta, garantindo a entrega do usage antes.
    const expectsTrailingUsage = provider === 'openai' || provider === 'openrouter' || provider === 'modal'

    if (provider === 'openai') {
      hostname = 'api.openai.com'
      apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      bodyObj = { model, messages, tools: tools?.length ? tools : undefined, stream: true, stream_options: openaiStreamOpts, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'openrouter') {
      hostname = 'openrouter.ai'
      apiPath = '/api/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/mrtjr/openclaude-desktop', 'X-Title': 'OpenClaude Desktop' }
      bodyObj = { model, messages, tools: tools?.length ? tools : undefined, stream: true, stream_options: openaiStreamOpts, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'modal') {
      hostname = modalHostname || 'api.us-west-2.modal.direct'
      apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'OpenClaude-Desktop' }
      bodyObj = { model, messages, tools: tools?.length ? tools : undefined, stream: true, stream_options: openaiStreamOpts, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'anthropic') {
      hostname = 'api.anthropic.com'
      apiPath = '/v1/messages'
      const systemMsg = messages.find(m => m.role === 'system')
      const anthropicMsgs = []
      for (const m of messages.filter(msg => msg.role !== 'system')) {
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const content = []
          if (m.content) content.push({ type: 'text', text: m.content })
          for (const tc of m.tool_calls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })() })
          }
          anthropicMsgs.push({ role: 'assistant', content })
        } else if (m.role === 'tool') {
          anthropicMsgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || '', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] })
        } else {
          anthropicMsgs.push({ role: m.role, content: toAnthropicContent(m.content) })
        }
      }
      const anthropicTools = tools?.length ? tools.map(t => ({ name: t.function.name, description: t.function.description || '', input_schema: t.function.parameters || { type: 'object', properties: {} } })) : undefined
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      // Opus 4.7/4.8/Fable 5 rejeitam temperature (400) — só envia onde é aceita.
      bodyObj = { model, max_tokens: max_tokens || 4096, messages: anthropicMsgs, ...(systemMsg ? { system: cachedSystem(systemMsg.content) } : {}), ...(anthropicAcceptsTemperature(model) ? { temperature: temperature ?? 0.7 } : {}), stream: true, ...(anthropicTools ? { tools: withCachedTools(anthropicTools) } : {}) }
    } else if (provider === 'custom') {
      const cfg = parseCustomBase(customBaseUrl)
      if (!cfg) return resolve({ error: 'Custom provider: invalid baseUrl' })
      hostname = cfg.hostname
      port = cfg.port
      transport = cfg.transport
      apiPath = `${cfg.basePath}/chat/completions`
      headers = { 'Content-Type': 'application/json', 'User-Agent': 'OpenClaude-Desktop' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      bodyObj = { model, messages, tools: tools?.length ? tools : undefined, stream: true, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else {
      return resolve({ error: `Provider "${provider}" does not support streaming` })
    }

    // Esforço de raciocínio (v2.25.0). 'default' não muda nada; caso contrário
    // mescla os params específicos do provider (enable_thinking / reasoning_effort
    // / thinking budget). Anthropic com thinking: remove temperature e garante
    // max_tokens > budget.
    applyReasoning(bodyObj, provider, model, reasoningEffort)
    if (toolChoice && bodyObj.tools && bodyObj.tools.length) bodyObj.tool_choice = toolChoice // forçar/proibir ferramenta (v2.141.0)

    const body = JSON.stringify(bodyObj)
    const reqOptions = { hostname, ...(port ? { port } : {}), path: apiPath, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }

    let doneSent = false
    // Content-level stall watchdog — armed once headers arrive. The socket
    // idle timeout below resets on ANY bytes, so a provider that stalls but
    // keeps sending SSE keep-alives (OpenRouter comments, Anthropic pings)
    // froze the UI forever. touch() only on real content; on stall we destroy
    // the request so the renderer gets done+error instead of a stuck cursor.
    let stallWatchdog = null
    // Socket idle budget currently in effect — 'connect' at first, tightened
    // to 'stream' once headers arrive. The timeout message reads it at fire time.
    let idleBudgetMs = 0
    const sendDone = (error) => {
      if (doneSent) return
      doneSent = true
      if (stallWatchdog) stallWatchdog.stop()
      activeProviderStream = null
      try { event.sender.send('ollama-stream-chunk', { done: true, ...(error ? { error } : {}) }) } catch (e) { console.error('[provider-stream] sendDone error:', e) }
    }

    const req = transport.request(reqOptions, (res) => {
      // Response headers arrived → past any cold start. Tighten the socket idle
      // window so a mid-stream stall is caught sooner than the generous connect
      // budget (token gaps in SSE are short; see provider-timeouts.js). The
      // original 'timeout' listener stays attached, so this just lowers the value.
      const streamIdleMs = providerTimeoutMs(provider, 'stream')
      idleBudgetMs = streamIdleMs // the 'timeout' listener below reads this at fire time
      req.setTimeout(streamIdleMs)
      stallWatchdog = createStallWatchdog(streamIdleMs, () => {
        const msg = `Stream travado: provider parou de enviar conteúdo por ${Math.round(streamIdleMs / 1000)}s (só keep-alive)`
        req.destroy()
        sendDone(msg)
        resolve({ ok: false, error: msg })
      })
      // Stateful UTF-8 decode — without it a multi-byte char split across two
      // TCP packets becomes U+FFFD mid-stream (silent, intermittent, and most
      // likely on long Modal streams in Portuguese).
      res.setEncoding('utf8')
      // Check HTTP status
      if (res.statusCode && res.statusCode >= 400) {
        let errorBody = ''
        res.on('data', (chunk) => { if (errorBody.length < 65536) errorBody += chunk.toString() })
        res.on('end', () => {
          let errMsg = `HTTP ${res.statusCode}`
          try { const parsed = JSON.parse(errorBody); errMsg = parsed.error?.message || parsed.error || errMsg } catch (e) { /* non-JSON error body */ }
          sendDone(errMsg)
          resolve({ ok: false, error: errMsg })
        })
        return
      }

      let buffer = ''
      // Anthropic streaming state
      let anthropicToolAccum = {} // { [index]: { id, name, argsStr } }
      // Anthropic usage accumulator — message_start gives input_tokens,
      // message_delta gives the final output_tokens. Emit one synthetic
      // OpenAI-shaped usage chunk at the end so useChat has a uniform path.
      let anthropicUsage = { prompt_tokens: 0, completion_tokens: 0 }

      res.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const jsonStr = trimmed.slice(6)
          if (jsonStr === '[DONE]') { sendDone(); continue }
          try {
            const parsed = JSON.parse(jsonStr)

            if (provider === 'anthropic') {
              // Normalize Anthropic SSE events to OpenAI chunk format
              const evType = parsed.type
              // Any real event resets the stall watchdog — but NOT 'ping',
              // which is exactly the keep-alive a stalled stream keeps sending.
              if (evType !== 'ping' && stallWatchdog) stallWatchdog.touch()
              if (evType === 'message_start') {
                const u = parsed.message?.usage
                if (u) {
                  anthropicUsage.prompt_tokens = (u.input_tokens || 0)
                    + (u.cache_read_input_tokens || 0)
                    + (u.cache_creation_input_tokens || 0)
                  anthropicUsage.completion_tokens = u.output_tokens || 0
                }
              } else if (evType === 'content_block_delta') {
                const delta = parsed.delta
                if (delta?.type === 'text_delta') {
                  event.sender.send('ollama-stream-chunk', { choices: [{ delta: { content: delta.text }, finish_reason: null }] })
                } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                  // Extended thinking → normaliza para o campo OpenAI-compat que
                  // o indicador de fase invisível já entende (streamPhase.ts).
                  // Não vai para o texto visível — só alimenta o sinal de vida.
                  event.sender.send('ollama-stream-chunk', { choices: [{ delta: { reasoning_content: delta.thinking }, finish_reason: null }] })
                } else if (delta?.type === 'input_json_delta') {
                  const idx = parsed.index
                  if (anthropicToolAccum[idx]) anthropicToolAccum[idx].argsStr += delta.partial_json
                }
              } else if (evType === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                const idx = parsed.index
                anthropicToolAccum[idx] = { id: parsed.content_block.id, name: parsed.content_block.name, argsStr: '' }
              } else if (evType === 'message_delta') {
                if (parsed.usage?.output_tokens != null) {
                  anthropicUsage.completion_tokens = parsed.usage.output_tokens
                }
                if (parsed.delta?.stop_reason) {
                  const toolEntries = Object.values(anthropicToolAccum)
                  if (toolEntries.length > 0) {
                    const tool_calls = toolEntries.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.argsStr } }))
                    event.sender.send('ollama-stream-chunk', { choices: [{ delta: { tool_calls }, finish_reason: 'tool_calls' }] })
                  } else {
                    // Caso TEXTO: o Anthropic não emite finish_reason em SSE, então
                    // o renderer nunca saberia que a resposta foi cortada por
                    // max_tokens. Mapeia stop_reason → finish_reason OpenAI-shape
                    // ('max_tokens'/'end_turn'→'stop') p/ ligar "Continuar gerando".
                    const fr = parsed.delta.stop_reason === 'end_turn' ? 'stop' : parsed.delta.stop_reason
                    event.sender.send('ollama-stream-chunk', { choices: [{ delta: {}, finish_reason: fr }] })
                  }
                  // Emit final usage in OpenAI-shape so the renderer has a single path.
                  event.sender.send('ollama-stream-chunk', { choices: [], usage: { ...anthropicUsage, total_tokens: anthropicUsage.prompt_tokens + anthropicUsage.completion_tokens } })
                  sendDone()
                }
              } else if (evType === 'message_stop') {
                sendDone()
              } else if (evType === 'error') {
                sendDone(parsed.error?.message || 'Anthropic stream error')
              }
            } else {
              // OpenAI-compatible SSE — pass through directly.
              // With stream_options.include_usage the final chunk has
              // `choices: []` + a `usage` field; useChat picks it up.
              // Keep-alives here are SSE comments (`: OPENROUTER PROCESSING`)
              // that never reach JSON.parse, so every parsed chunk is content.
              if (stallWatchdog) stallWatchdog.touch()
              event.sender.send('ollama-stream-chunk', parsed)
              // Só encerra no finish_reason quando NÃO há usage atrasado a
              // entregar; senão espera o [DONE]/fim (ver expectsTrailingUsage).
              if (parsed.choices?.[0]?.finish_reason && !expectsTrailingUsage) sendDone()
            }
          } catch (e) { console.error('[provider-stream] SSE parse error:', e.message) }
        }
      })

      res.on('end', () => { sendDone(); resolve({ ok: true }) })
    })

    req.on('error', (err) => { sendDone(err.message); resolve({ ok: false, error: err.message }) })
    // Start on the generous 'connect' budget (Modal cold start); the res
    // callback above tightens it to 'stream' once headers arrive and updates
    // idleBudgetMs so the message reports the budget that actually fired.
    idleBudgetMs = providerTimeoutMs(provider, 'connect')
    req.setTimeout(idleBudgetMs, () => { req.destroy(); sendDone(`Provider request timeout after ${idleBudgetMs / 1000}s`) })
    activeProviderStream = req
    req.write(body)
    req.end()
  })
})

// ─── IPC: List provider models (OpenRouter, OpenAI, Gemini, Anthropic) ──
ipcMain.handle('list-provider-models', async (event, { provider, apiKey, modalHostname, customBaseUrl }) => {
  return new Promise((resolve) => {
    let hostname, apiPath, headers, query = ''
    let transport = https
    let port
    void query

    if (provider === 'openai') {
      hostname = 'api.openai.com'
      apiPath = '/v1/models'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'openrouter') {
      hostname = 'openrouter.ai'
      apiPath = '/api/v1/models'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'modal') {
      hostname = modalHostname || 'api.us-west-2.modal.direct'
      apiPath = '/v1/models'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'anthropic') {
      hostname = 'api.anthropic.com'
      apiPath = '/v1/models'
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com'
      apiPath = `/v1beta/models?key=${apiKey}`
      headers = { 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'custom') {
      const cfg = parseCustomBase(customBaseUrl)
      if (!cfg) return resolve({ error: 'Custom provider: invalid baseUrl' })
      hostname = cfg.hostname
      port = cfg.port
      transport = cfg.transport
      apiPath = `${cfg.basePath}/models`
      headers = { 'User-Agent': 'OpenClaude-Desktop' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    } else {
      return resolve({ error: `Provider "${provider}" not supported for model listing` })
    }

    const options = {
      hostname,
      ...(port ? { port } : {}),
      path: apiPath,
      method: 'GET',
      headers
    }

    const req = transport.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD na fronteira de pacote)
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) {
            return resolve({ error: `API error ${res.statusCode}: ${JSON.stringify(parsed)}` })
          }

          let models = []
          if (provider === 'openai' || provider === 'openrouter' || provider === 'modal' || provider === 'custom') {
            models = (parsed.data || []).map(m => m.id).sort()
          } else if (provider === 'anthropic') {
            models = (parsed.data || []).map(m => m.id).sort()
          } else if (provider === 'gemini') {
            // Filter models that support generateContent
            models = (parsed.models || [])
              .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
              .map(m => m.name.replace('models/', ''))
              .sort()
          }
          resolve({ models, error: null })
        } catch (e) { resolve({ error: e.message }) }
      })
    })

    req.on('error', (e) => resolve({ error: e.message }))
    req.end()
  })
})

// ─── IPC: Browser Automation (Electron BrowserWindow nativo) ──────────
// Arquitetura inspirada em Claude Computer Use / Manus AI:
// - Browser VISÍVEL ao lado do chat (o usuário vê o agente navegar)
// - Screenshot → Vision AI → Ação por coordenadas (x, y)
// - Também suporta DOM tools (get_text, get_links) para scraping rápido
// - Zero dependência externa — usa Chromium embutido do Electron

const BROWSER_CONFIG = {
  MAX_TABS: 5,
  NAV_TIMEOUT: 30_000,
  SCRIPT_TIMEOUT: 10_000,
  MAX_TEXT_LENGTH: 15_000,
  VIEWPORT_WIDTH: 1280,
  VIEWPORT_HEIGHT: 800,
  SETTLE_DELAY: 800, // ms to wait after action for page to settle
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

/** @type {Map<string, Electron.BrowserWindow>} */
const browserTabs = new Map()
let activeTabId = 'main'
// Headless por padrão (estilo Claude: ler/varrer NÃO abre janela). A janela só
// aparece para ferramentas visuais (screenshot / clique por coordenada). Para
// só LER uma página, o modelo usa `fetch_url` (HTTP puro, sem motor de browser).
let browserVisible = false

/** Garante a janela visível antes de uma operação que precisa de pintura
 *  (capturePage não funciona de forma confiável em janela oculta). Usa
 *  showInactive para não roubar o foco do app. */
function ensureTabVisible(bw) {
  try { if (bw && !bw.isDestroyed() && !bw.isVisible()) bw.showInactive() } catch { /* ignore */ }
}

function getOrCreateTab(tabId = 'main', visible = browserVisible) {
  if (browserTabs.has(tabId)) {
    const existing = browserTabs.get(tabId)
    if (!existing.isDestroyed()) {
      if (visible && !existing.isVisible()) existing.show()
      return existing
    }
    browserTabs.delete(tabId)
  }
  if (browserTabs.size >= BROWSER_CONFIG.MAX_TABS) {
    const oldest = browserTabs.keys().next().value
    const oldWin = browserTabs.get(oldest)
    if (oldWin && !oldWin.isDestroyed()) oldWin.close()
    browserTabs.delete(oldest)
  }

  // Position browser window to the right of the main app window
  let x = 100, y = 100
  if (win && !win.isDestroyed()) {
    const [wx, wy] = win.getPosition()
    const [ww] = win.getSize()
    x = wx + ww + 10 // 10px gap to the right
    y = wy
  }

  const bw = new BrowserWindow({
    width: BROWSER_CONFIG.VIEWPORT_WIDTH,
    height: BROWSER_CONFIG.VIEWPORT_HEIGHT,
    x, y,
    show: visible,
    title: 'OpenClaude Browser',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  bw.webContents.setUserAgent(BROWSER_CONFIG.USER_AGENT)
  bw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  bw.on('closed', () => browserTabs.delete(tabId))

  // Notify renderer when page finishes loading
  bw.webContents.on('did-finish-load', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('browser-page-loaded', {
        tabId,
        url: bw.webContents.getURL(),
        title: bw.webContents.getTitle(),
      })
    }
  })

  browserTabs.set(tabId, bw)
  return bw
}

function getActiveTab() {
  const bw = browserTabs.get(activeTabId)
  if (bw && !bw.isDestroyed()) return bw
  return null
}

/** Wait for the page to settle after an action */
function settle(ms) {
  return new Promise(r => setTimeout(r, ms || BROWSER_CONFIG.SETTLE_DELAY))
}

ipcMain.handle('browser-launch', async (event, opts) => {
  const { visible = browserVisible, tabId = 'main' } = opts || {}
  try {
    const bw = getOrCreateTab(tabId, visible)
    activeTabId = tabId
    return { success: true, tabId }
  } catch (e) {
    return { error: `Browser launch error: ${e.message}` }
  }
})

ipcMain.handle('browser-navigate', async (event, url) => {
  let bw
  try {
    bw = getOrCreateTab(activeTabId || 'main')
    activeTabId = activeTabId || 'main'
  } catch (e) {
    return { error: `Browser launch error: ${e.message}` }
  }

  // Normalize URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
  }

  // Headless por padrão: só mostra a janela se o usuário optou por "ver o agente
  // navegar". Para só ler uma página, prefira fetch_url (sem janela alguma).
  if (browserVisible && !bw.isVisible()) bw.show()

  // Race loadURL against NAV_TIMEOUT — but DON'T let a rejection abort the
  // whole handler. A redirect (ERR_ABORTED) or a page with slow trackers often
  // STILL rendered usable content; the old code threw it all away as an error,
  // which made the renderer re-launch + re-navigate from scratch (the wasted
  // retry latency the Dev Insights digest shows). Instead we capture the
  // error/timeout, read whatever the page produced, and let resolveNavOutcome()
  // decide success vs. partial vs. genuine failure (see browser-nav.js).
  let navError = null
  let timedOut = false
  await new Promise((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    const timer = setTimeout(() => { timedOut = true; done() }, BROWSER_CONFIG.NAV_TIMEOUT)
    bw.loadURL(url)
      .then(() => { clearTimeout(timer); done() })
      .catch((e) => { navError = (e && e.message) || String(e); clearTimeout(timer); done() })
  })

  // On timeout, stop pending sub-resources so the DOM we read is stable.
  if (timedOut && bw && !bw.isDestroyed()) {
    try { bw.webContents.stop() } catch { /* ignore */ }
  }

  // Let JS-rendered content settle (shorter when we already waited out a timeout).
  await settle(timedOut ? 200 : 500)

  // Read whatever rendered — guarded, since extraction can fail on a dead page.
  let finalUrl = '', title = '', text = ''
  try {
    if (bw && !bw.isDestroyed()) {
      finalUrl = bw.webContents.getURL()
      title = bw.webContents.getTitle()
      text = await bw.webContents.executeJavaScript(`
        (() => {
          const sel = document.querySelector('article') || document.querySelector('main') || document.body;
          return sel ? sel.innerText.substring(0, ${BROWSER_CONFIG.MAX_TEXT_LENGTH}) : '';
        })()
      `)
    }
  } catch { /* keep whatever we already captured */ }

  // Bonus: collect the top interactive elements in the SAME settle window so
  // the model can click/type on its NEXT turn without a separate get_links/
  // get_forms round-trip. Guarded — if it fails, navigate still returns text.
  let elements = null
  try {
    if (bw && !bw.isDestroyed()) {
      elements = await bw.webContents.executeJavaScript(`
        (() => {
          const links = Array.from(document.querySelectorAll('a[href]'))
            .map(a => ({ text: (a.innerText || a.title || '').trim().substring(0, 60), href: a.href }))
            .filter(l => l.text && l.href.startsWith('http'))
            .slice(0, 12);
          const fields = Array.from(document.querySelectorAll('input, textarea, select, button[type="submit"]'))
            .slice(0, 12)
            .map((el, i) => {
              let s = el.id ? '#' + el.id : el.name ? '[name="' + el.name + '"]' : '';
              if (!s) { el.setAttribute('data-oc-sel', 'ocn' + i); s = '[data-oc-sel="ocn' + i + '"]'; }
              return { tag: el.tagName.toLowerCase(), type: el.type || '', placeholder: el.placeholder || '', selector: s };
            });
          return { links, fields };
        })()
      `)
    }
  } catch { /* elements are a bonus; navigate still returns text */ }

  const outcome = resolveNavOutcome({ error: navError, timedOut, finalUrl, textLength: text.length })
  if (!outcome.ok) return { error: outcome.note }
  return {
    success: true,
    url: finalUrl,
    title,
    text,
    ...(elements ? { elements } : {}),
    ...(outcome.partial ? { partial: true, note: outcome.note } : {}),
  }
})

ipcMain.handle('browser-screenshot', async () => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    ensureTabVisible(bw)  // capturePage exige a janela pintada (mesmo se headless)
    const image = await bw.webContents.capturePage()
    const src = image.getSize()
    // Downscale wide viewports + encode JPEG (~10× smaller than the old full
    // PNG). See electron/screenshot-util.js for why (hot-path waste).
    const plan = planScreenshot({ width: src.width, height: src.height })
    const out = plan.scaled
      ? image.resize({ width: plan.width, height: plan.height, quality: 'good' })
      : image
    const buf = out.toJPEG(SHOT_JPEG_QUALITY)
    return {
      success: true,
      base64: buf.toString('base64'),
      mime: 'image/jpeg',
      width: plan.width,
      height: plan.height,
      size: buf.length,
    }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-get-text', async (event, { selector, maxLength } = {}) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    const max = maxLength || BROWSER_CONFIG.MAX_TEXT_LENGTH
    const code = selector
      ? `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText.substring(0, ${max}) : '(element not found: ${selector})'; })()`
      : `(() => { const sel = document.querySelector('article') || document.querySelector('main') || document.body; return sel ? sel.innerText.substring(0, ${max}) : ''; })()`
    const text = await bw.webContents.executeJavaScript(code)
    return { success: true, text }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-click', async (event, selector) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    const result = await bw.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) {
          // Not found — return a few clickable candidates so the model can
          // re-click correctly in the SAME next turn, instead of spending a
          // round-trip on get_forms/get_links just to discover what exists.
          const cands = Array.from(document.querySelectorAll('a[href], button, input, select, [role="button"], [onclick]'))
            .slice(0, 8)
            .map((c, i) => {
              let s = c.id ? '#' + c.id : c.name ? '[name="' + c.name + '"]' : '';
              if (!s) { c.setAttribute('data-oc-sel', 'occ' + i); s = '[data-oc-sel="occ' + i + '"]'; }
              return { selector: s, text: (c.innerText || c.value || c.title || '').trim().substring(0, 50), tag: c.tagName.toLowerCase() };
            });
          return { error: 'Element not found: ${selector.replace(/'/g, "\\'")}', candidates: cands };
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { success: true, tag: el.tagName, text: el.innerText?.substring(0, 100) };
      })()
    `)
    return result
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-type', async (event, { selector, text, pressEnter }) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    const result = await bw.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { error: 'Element not found: ${selector.replace(/'/g, "\\'")}' };
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        ${pressEnter ? `el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));` : ''}
        return { success: true };
      })()
    `)
    return result
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-evaluate', async (event, code) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  // Guards (v2.112.0): este handler executa JS arbitrário na página. Recusa
  // entrada não-string ou gigante antes de avaliar (defesa em profundidade).
  if (typeof code !== 'string') return { error: 'browser-evaluate: code deve ser string' }
  if (code.length > 50000) return { error: 'browser-evaluate: code grande demais (máx 50000 chars)' }
  try {
    const result = await bw.webContents.executeJavaScript(code)
    return { success: true, result: JSON.stringify(result).substring(0, 8000) }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-wait', async (event, { selector, timeout }) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  const ms = Math.min(timeout || 5000, BROWSER_CONFIG.SCRIPT_TIMEOUT)
  try {
    const result = await bw.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) return resolve({ success: true, found: true });
        const observer = new MutationObserver(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) { observer.disconnect(); resolve({ success: true, found: true }); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve({ success: false, found: false }); }, ${ms});
      })
    `)
    return result
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-get-links', async () => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    const links = await bw.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(a => ({
        text: (a.innerText || a.title || '').trim().substring(0, 80),
        href: a.href,
      })).filter(l => l.href.startsWith('http'))
    `)
    return { success: true, links }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-get-forms', async () => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    const forms = await bw.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('input, textarea, select, button[type="submit"]')).slice(0, 50).map((el, i) => {
        // Elements with a natural id/name keep their selector UNCHANGED. Those
        // without one (common in SPAs) used to be dropped — forcing the model
        // onto the slow vision path (screenshot + click_at). Tag them with a
        // stable data attribute so they still get a usable selector.
        let selector = el.id ? '#' + el.id : el.name ? '[name="' + el.name + '"]' : '';
        if (!selector) { el.setAttribute('data-oc-sel', 'oc' + i); selector = '[data-oc-sel="oc' + i + '"]'; }
        return {
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          name: el.name || el.id || '',
          placeholder: el.placeholder || '',
          selector: selector,
          value: el.value ? el.value.substring(0, 50) : '',
        };
      })
    `)
    return { success: true, forms }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-close', async (event, tabId) => {
  try {
    const id = tabId || activeTabId
    const bw = browserTabs.get(id)
    if (bw && !bw.isDestroyed()) bw.close()
    browserTabs.delete(id)
    if (activeTabId === id) {
      activeTabId = browserTabs.keys().next().value || 'main'
    }
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-tabs', async () => {
  const tabs = []
  for (const [id, bw] of browserTabs) {
    if (bw.isDestroyed()) continue
    tabs.push({
      id,
      active: id === activeTabId,
      url: bw.webContents.getURL(),
      title: bw.webContents.getTitle(),
    })
  }
  return { tabs, activeTabId }
})

ipcMain.handle('browser-switch-tab', async (event, tabId) => {
  if (browserTabs.has(tabId)) {
    activeTabId = tabId
    return { success: true, tabId }
  }
  return { error: `Tab not found: ${tabId}` }
})

// ─── Computer Use: Vision-based interaction (Claude/Manus style) ──────
// O agente tira screenshot, envia para vision AI, recebe coordenadas (x,y)
// e executa ações por pixel — o usuário vê tudo na janela do browser.

ipcMain.handle('browser-click-at', async (event, { x, y }) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    bw.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
    bw.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
    await settle()
    return { success: true, x, y }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-double-click-at', async (event, { x, y }) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    bw.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 2 })
    bw.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 2 })
    await settle()
    return { success: true, x, y }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-type-text', async (event, { text }) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    for (const char of text) {
      bw.webContents.sendInputEvent({ type: 'char', keyCode: char })
    }
    await settle(300)
    return { success: true, typed: text.length }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-key-press', async (event, { key }) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    // Map common key names to Electron keyCode format
    const keyMap = {
      'Enter': '\r', 'Tab': '\t', 'Escape': '\u001b', 'Backspace': '\b',
      'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
      'Space': ' ',
    }
    const mapped = keyMap[key] || key
    bw.webContents.sendInputEvent({ type: 'keyDown', keyCode: mapped })
    bw.webContents.sendInputEvent({ type: 'keyUp', keyCode: mapped })
    await settle(200)
    return { success: true, key }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-scroll', async (event, { x, y, deltaY }) => {
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    const cx = Math.round(x || BROWSER_CONFIG.VIEWPORT_WIDTH / 2)
    const cy = Math.round(y || BROWSER_CONFIG.VIEWPORT_HEIGHT / 2)
    bw.webContents.sendInputEvent({ type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: Math.round(deltaY || -300) })
    await settle(500)
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-screenshot-vision', async () => {
  // Optimized screenshot for vision AI — returns base64 PNG + viewport dimensions
  const bw = getActiveTab()
  if (!bw) return { error: 'No active browser tab' }
  try {
    ensureTabVisible(bw)  // capturePage exige a janela pintada (mesmo se headless)
    const image = await bw.webContents.capturePage()
    const buf = image.toPNG()
    const size = image.getSize()
    return {
      success: true,
      base64: buf.toString('base64'),
      width: size.width,
      height: size.height,
      url: bw.webContents.getURL(),
      title: bw.webContents.getTitle(),
    }
  } catch (e) { return { error: e.message } }
})

// ─── IPC: MCP Client ────────────────────────────────────────────────────
const mcpConnections = new Map()

ipcMain.handle('mcp-connect', async (event, { id, command, args, env }) => {
  try {
    // Evita vazar processo: se já há uma conexão com esse id (reconexão por
    // mudança de config), mata a anterior antes de subir a nova.
    const existing = mcpConnections.get(id)
    if (existing) {
      try { existing.proc.kill() } catch (e) { /* best-effort */ }
      mcpConnections.delete(id)
    }
    const { spawn } = require('child_process')
    const proc = spawn(command, args || [], {
      env: { ...process.env, ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let buffer = ''
    const pendingRequests = new Map()
    let requestId = 0
    // Captura stderr do servidor (v2.121.0): diagnósticos de falha de
    // handshake/plugin iam pro vazio. Mantém os últimos ~4KB.
    let stderrBuf = ''
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (d) => { stderrBuf = (stderrBuf + d).slice(-4096) })
    }

    // Timeout POR MÉTODO (v2.121.0): 15s fixo travava tools/list em servidores
    // grandes e tools/call de rede. discovery/handshake = 30s; tools/call
    // configurável (default 60s). Inclui o stderr recente no erro de timeout.
    const sendRequest = (method, params, timeoutMs = 30000) => {
      return new Promise((resolve, reject) => {
        const rid = ++requestId
        const msg = JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n'
        pendingRequests.set(rid, { resolve, reject })
        try { proc.stdin.write(msg) } catch (e) { pendingRequests.delete(rid); return reject(new Error('MCP stdin closed: ' + e.message)) }
        setTimeout(() => {
          if (pendingRequests.has(rid)) {
            pendingRequests.delete(rid)
            reject(new Error(`MCP timeout (${method}, ${timeoutMs}ms)` + (stderrBuf.trim() ? ` — stderr: ${stderrBuf.trim().slice(0, 500)}` : '')))
          }
        }, Math.max(1000, timeoutMs))
      })
    }

    // Notificação (sem id, sem resposta) — exigida pelo handshake MCP.
    const sendNotification = (method, params) => {
      try { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n') } catch (e) { /* best-effort */ }
    }

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id && pendingRequests.has(msg.id)) {
            const { resolve } = pendingRequests.get(msg.id)
            pendingRequests.delete(msg.id)
            resolve(msg.result || msg.error || msg)
          }
        } catch (e) { /* incomplete JSON chunk, ignore */ }
      }
    })

    // Se o processo morre/erra, remove do Map e AVISA o renderer para podar as
    // tools desse servidor (senão o modelo continua tentando tools mortas).
    const notifyExit = () => {
      mcpConnections.delete(id)
      try { if (win && !win.isDestroyed()) win.webContents.send('mcp-server-exit', { id }) } catch (e) { /* best-effort */ }
    }
    proc.on('error', notifyExit)
    proc.on('exit', notifyExit)

    mcpConnections.set(id, { proc, sendRequest, getStderr: () => stderrBuf })

    try {
      // Initialize (handshake = 30s)
      const initResult = await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'OpenClaude Desktop', version: '1.4.0' }
      }, 30000)

      // Handshake MCP: o cliente DEVE notificar 'initialized' após o initialize
      // antes de chamar tools/list — sem isso, servidores estritos travam.
      sendNotification('notifications/initialized', {})

      // List tools (discovery pode ser lenta em FS grande → 30s)
      const toolsResult = await sendRequest('tools/list', {}, 30000)

      return { success: true, serverInfo: initResult, tools: toolsResult?.tools || [] }
    } catch (initErr) {
      // Falha no handshake (v2.121.0): NÃO deixa o processo órfão rodando.
      try { proc.kill() } catch (e) { /* best-effort */ }
      mcpConnections.delete(id)
      const tail = stderrBuf.trim() ? ` — stderr: ${stderrBuf.trim().slice(0, 500)}` : ''
      return { error: (initErr.message || 'MCP init falhou') + tail }
    }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('mcp-call-tool', async (event, { connectionId, toolName, args, timeoutMs }) => {
  const conn = mcpConnections.get(connectionId)
  if (!conn) return { error: 'MCP server not connected' }
  try {
    const result = await conn.sendRequest('tools/call', { name: toolName, arguments: args || {} }, Math.min(Math.max(Number(timeoutMs) || 60000, 1000), 300000))
    return { success: !result?.isError, isError: !!result?.isError, result: formatMcpContent(result) }
  } catch (e) {
    const tail = conn.getStderr && conn.getStderr().trim() ? ` — stderr: ${conn.getStderr().trim().slice(0, 300)}` : ''
    return { error: (e.message || 'MCP error') + tail }
  }
})

ipcMain.handle('mcp-disconnect', async (event, id) => {
  const conn = mcpConnections.get(id)
  if (conn) {
    conn.proc.kill()
    mcpConnections.delete(id)
  }
  return { success: true }
})

ipcMain.handle('mcp-list-connections', async () => {
  return [...mcpConnections.keys()]
})

// ─── IPC: Collaborative Agents (Parallel Execution) ─────────────────────
ipcMain.handle('parallel-chat', async (event, { tasks, model, temperature, max_tokens }) => {
  // tasks = [{ id, messages, tools }]
  const executeTask = (task) => {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        model,
        messages: task.messages,
        tools: task.tools || [],
        stream: false,
        options: { temperature: temperature ?? 0.7 },
        ...(max_tokens ? { max_tokens } : {})
      })

      const options = {
        hostname: 'localhost',
        port: 11434,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }

      const req = http.request(options, (res) => {
        let data = ''
        res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD)
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            resolve({ id: task.id, result: parsed, error: null })
          } catch (e) {
            resolve({ id: task.id, result: null, error: e.message })
          }
        })
      })
      req.on('error', (e) => resolve({ id: task.id, result: null, error: e.message }))
      req.setTimeout(120000, () => { req.destroy(); resolve({ id: task.id, result: null, error: 'Timeout' }) })
      req.write(body)
      req.end()
    })
  }

  const results = await Promise.all(tasks.map(executeTask))
  return results
})

// ─── IPC: Provider-agnostic parallel-chat (Modal pool, OpenAI, etc.) ───
// Each task may carry its own `apiKey` (used for per-key pool dispatch on Modal).
// Keep-alive agent reuses TLS connections across subtasks (~200ms faster each).
// Tuning constants mirror src/constants/pool.ts (POOL_CONFIG).
const MODAL_POOL_CONFIG = { MAX_SOCKETS: 20, KEEP_ALIVE_MSECS: 30_000, REQUEST_TIMEOUT_MS: 120_000 }
const modalKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: MODAL_POOL_CONFIG.MAX_SOCKETS,
  keepAliveMsecs: MODAL_POOL_CONFIG.KEEP_ALIVE_MSECS,
})
ipcMain.handle('provider-parallel-chat', async (event, { tasks, provider, model, temperature, max_tokens, hostname }) => {
  const executeTask = (task) => {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        model,
        messages: task.messages,
        tools: task.tools || [],
        stream: false,
        temperature: temperature ?? 0.7,
        ...(max_tokens ? { max_tokens } : {})
      })

      let options
      if (provider === 'modal') {
        options = {
          hostname: hostname || 'api.us-west-2.modal.direct',
          port: 443,
          path: '/v1/chat/completions',
          method: 'POST',
          agent: modalKeepAliveAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization': `Bearer ${task.apiKey || ''}`,
            'Connection': 'keep-alive'
          }
        }
      } else {
        // Default: Ollama local
        options = {
          hostname: 'localhost',
          port: 11434,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }
      }

      const client = (provider === 'modal') ? https : http
      const req = client.request(options, (res) => {
        let data = ''
        res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD)
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            resolve({ id: task.id, result: null, error: `HTTP ${res.statusCode}: ${data.slice(0, 200)}`, apiKey: task.apiKey })
            return
          }
          try {
            const parsed = JSON.parse(data)
            resolve({ id: task.id, result: parsed, error: null, apiKey: task.apiKey })
          } catch (e) {
            resolve({ id: task.id, result: null, error: e.message, apiKey: task.apiKey })
          }
        })
      })
      req.on('error', (e) => resolve({ id: task.id, result: null, error: e.message, apiKey: task.apiKey }))
      req.setTimeout(MODAL_POOL_CONFIG.REQUEST_TIMEOUT_MS, () => { req.destroy(); resolve({ id: task.id, result: null, error: 'Timeout', apiKey: task.apiKey }) })
      req.write(body)
      req.end()
    })
  }

  const results = await Promise.all(tasks.map(executeTask))
  return results
})

// ─── IPC: Audit Log ────────────────────────────────────────────────────
function loadAuditLog() {
  try {
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf-8'))
    }
  } catch (e) { console.error('[audit-log] load error:', e) }
  return []
}

function saveAuditLog(entries) {
  try {
    // Keep max 1000 entries, auto-purge old
    const trimmed = entries.slice(-1000)
    atomicWriteJSON(AUDIT_LOG_PATH, trimmed)
  } catch (e) { console.error('[audit-log] save error:', e) }
}

ipcMain.handle('audit-log-append', async (event, entry) => {
  const log = loadAuditLog()
  log.push({ ...entry, timestamp: Date.now() })
  saveAuditLog(log)
  return { error: null }
})

ipcMain.handle('audit-log-load', async () => {
  return loadAuditLog()
})

ipcMain.handle('audit-log-clear', async () => {
  saveAuditLog([])
  return { error: null }
})

// ─── IPC: Analytics (MCD/MAGI/MASA) ────────────────────────────────────
ipcMain.handle('analytics-save-session', async (event, sessionData) => {
  const analytics = loadAnalytics()
  analytics.sessions.push({
    ...sessionData,
    timestamp: Date.now()
  })
  // Update global stats
  analytics.globalStats.totalSessions++
  analytics.globalStats.totalToolCalls += sessionData.toolCalls || 0
  analytics.globalStats.totalErrors += sessionData.errors || 0
  if (sessionData.agentMode) analytics.globalStats.totalAgentRuns++
  analytics.globalStats.totalCircuitBreaks += sessionData.circuitBreaks || 0
  return saveAnalytics(analytics)
})

ipcMain.handle('analytics-load', async () => {
  return loadAnalytics()
})

ipcMain.handle('analytics-get-insights', async () => {
  const analytics = loadAnalytics()
  const sessions = analytics.sessions || []
  if (sessions.length === 0) {
    return { hasData: false }
  }

  // MAGI: Generate insights from collected data
  const now = Date.now()
  const last7d = sessions.filter(s => s.timestamp > now - 7 * 24 * 60 * 60 * 1000)
  const last24h = sessions.filter(s => s.timestamp > now - 24 * 60 * 60 * 1000)

  // Tool usage frequency
  const toolFreq = {}
  for (const s of sessions) {
    if (s.toolsUsed) {
      for (const tool of s.toolsUsed) {
        toolFreq[tool.name] = (toolFreq[tool.name] || 0) + tool.count
      }
    }
  }
  const topTools = Object.entries(toolFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  // Model usage
  const modelFreq = {}
  for (const s of sessions) {
    if (s.model) {
      modelFreq[s.model] = (modelFreq[s.model] || 0) + 1
    }
  }
  const modelUsage = Object.entries(modelFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  // Average response time
  const responseTimes = sessions.filter(s => s.avgResponseTime > 0).map(s => s.avgResponseTime)
  const avgResponseTime = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0

  // Agent completion rate
  const agentSessions = sessions.filter(s => s.agentMode)
  const agentCompleted = agentSessions.filter(s => s.agentCompleted)
  const agentCompletionRate = agentSessions.length > 0
    ? Math.round((agentCompleted.length / agentSessions.length) * 100)
    : 0

  // Average agent steps
  const agentSteps = agentSessions.filter(s => s.agentSteps > 0).map(s => s.agentSteps)
  const avgAgentSteps = agentSteps.length > 0
    ? Math.round(agentSteps.reduce((a, b) => a + b, 0) / agentSteps.length * 10) / 10
    : 0

  // Error rate
  const totalInteractions = sessions.length
  const sessionsWithErrors = sessions.filter(s => (s.errors || 0) > 0).length
  const errorRate = totalInteractions > 0
    ? Math.round((sessionsWithErrors / totalInteractions) * 100)
    : 0

  // Provider usage
  const providerFreq = {}
  for (const s of sessions) {
    const p = s.provider || 'ollama'
    providerFreq[p] = (providerFreq[p] || 0) + 1
  }

  return {
    hasData: true,
    global: analytics.globalStats,
    period: {
      total: sessions.length,
      last7d: last7d.length,
      last24h: last24h.length
    },
    topTools,
    modelUsage,
    providerUsage: Object.entries(providerFreq).map(([name, count]) => ({ name, count })),
    avgResponseTime,
    agentCompletionRate,
    avgAgentSteps,
    errorRate,
    totalAgentRuns: agentSessions.length,
    totalCircuitBreaks: analytics.globalStats.totalCircuitBreaks
  }
})

ipcMain.handle('analytics-clear', async () => {
  const empty = { sessions: [], globalStats: { totalSessions: 0, totalToolCalls: 0, totalErrors: 0, totalAgentRuns: 0, totalCircuitBreaks: 0 } }
  return saveAnalytics(empty)
})


// ─── Parliament Mode: shared provider call utility ───────────────────────────
async function callProviderOnce({ provider, apiKey, model, messages, modalHostname }) {
  return new Promise((resolve) => {
    if (provider === 'ollama') {
      const body = JSON.stringify({ model, messages, stream: false, options: { temperature: 0.7 } })
      const opts = {
        hostname: 'localhost', port: 11434,
        path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }
      const req = http.request(opts, (res) => {
        let data = ''
        res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD)
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try { resolve(JSON.parse(data).choices?.[0]?.message?.content || '') }
          catch { resolve('') }
        })
      })
      req.on('error', (e) => resolve(`Erro Ollama: ${e.message}`))
      req.write(body)
      req.end()
      return
    }

    let hostname, apiPath, headers, bodyObj
    if (provider === 'openai') {
      hostname = 'api.openai.com'; apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      bodyObj = { model, messages, stream: false, temperature: 0.7, max_tokens: 4096 }
    } else if (provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com'
      const geminiContents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }]
      }))
      const systemInstruction = messages.find(m => m.role === 'system')
      apiPath = `/v1beta/models/${model}:generateContent?key=${apiKey}`
      headers = { 'Content-Type': 'application/json' }
      bodyObj = {
        contents: geminiContents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {})
      }
    } else if (provider === 'anthropic') {
      hostname = 'api.anthropic.com'; apiPath = '/v1/messages'
      const systemMsg = messages.find(m => m.role === 'system')
      const anthropicMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content || '' }))
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      bodyObj = { model, max_tokens: 4096, messages: anthropicMsgs, temperature: 0.7, ...(systemMsg ? { system: systemMsg.content } : {}) }
    } else if (provider === 'openrouter') {
      hostname = 'openrouter.ai'; apiPath = '/api/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/mrtjr/openclaude-desktop', 'X-Title': 'OpenClaude Desktop' }
      bodyObj = { model, messages, stream: false, temperature: 0.7, max_tokens: 4096 }
    } else if (provider === 'modal') {
      hostname = modalHostname || 'api.us-west-2.modal.direct'; apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      bodyObj = { model, messages, stream: false, temperature: 0.7, max_tokens: 4096 }
    } else {
      return resolve(`Provider "${provider}" nao suportado`)
    }

    const body = JSON.stringify(bodyObj)
    const reqOpts = { hostname, path: apiPath, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }
    const req = https.request(reqOpts, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD na fronteira de pacote)
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) return resolve(`Erro API ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`)
          if (provider === 'gemini') {
            resolve((parsed.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''))
          } else if (provider === 'anthropic') {
            resolve((parsed.content || []).filter(c => c.type === 'text').map(c => c.text).join(''))
          } else {
            resolve(parsed.choices?.[0]?.message?.content || '')
          }
        } catch (e) { resolve(`Erro de parse: ${e.message}`) }
      })
    })
    req.on('error', (e) => resolve(`Erro de rede: ${e.message}`))
    req.write(body)
    req.end()
  })
}


// ─── Parliament Mode: System Prompts ────────────────────────────────────────
const PARLIAMENT_ROLE_PROMPTS = {
  arquiteto: `Voce e o ARQUITETO no Parliament Mode. Analise o problema exclusivamente pelo prisma de DESIGN DE SISTEMAS E ARQUITETURA.

Foque em: estrutura e componentes, padroes arquiteturais (MVC, microservices, event-driven, etc.), escalabilidade e manutenabilidade, trade-offs de design e justificativas.
Use diagramas textuais (ASCII) quando ajudar. Seja tecnico e preciso.`,

  implementador: `Voce e o IMPLEMENTADOR no Parliament Mode. Analise o problema exclusivamente pelo prisma de IMPLEMENTACAO PRATICA.

Foque em: como implementar concretamente (linguagens, bibliotecas, APIs), passos praticos e ordem de implementacao, blockers tecnicos e como resolve-los, exemplos de codigo quando relevante.
Seja especifico e orientado a execucao imediata.`,

  seguranca: `Voce e o REVISOR DE SEGURANCA no Parliament Mode. Analise o problema exclusivamente pelo prisma de SEGURANCA E RISCO.

Foque em: vulnerabilidades potenciais e superficies de ataque, dados sensiveis e protecao, conformidade regulatoria (LGPD, GDPR, OWASP), medidas de mitigacao concretas.
Seja critico e nao ignore riscos por parecerem improvaveis. Pior caso primeiro.`,

  testador: `Voce e o TESTADOR no Parliament Mode. Analise o problema exclusivamente pelo prisma de QUALIDADE E TESTES.

Foque em: estrategia de testes (unitario, integracao, e2e, carga), casos de borda e cenarios de falha, metricas de qualidade e cobertura, automatizacao e CI/CD.
Seja sistematico. Considere sempre o caso infeliz.`,

  diabo: `Voce e o ADVOGADO DO DIABO no Parliament Mode. Seu papel e QUESTIONAR e DESAFIAR tudo.

Foque em: premissas questionaveis ou falsas, alternativas que podem ser superiores, complexidade desnecessaria (over-engineering), o que poderia dar completamente errado.
Seja cetico e direto. Voce fortalece a solucao atraves da critica construtiva. Nao valide o que nao merece validacao.`,

  coordenador: `Voce e o COORDENADOR FINAL do Parliament Mode. Voce recebeu analises de 5 especialistas distintos e deve sintetizar tudo em uma visao consolidada e acionavel.

SUA RESPOSTA DEVE TER EXATAMENTE ESTA ESTRUTURA:

## Consensos
(Pontos em que os especialistas concordam — o que e solido e deve ser feito)

## Divergencias
(Visoes conflitantes — explique cada lado e por que existe o conflito)

## Sintese e Recomendacao
(Sua decisao final, balanceando todas as perspectivas com justificativa)

## Proximos Passos
(3 a 5 acoes concretas, priorizadas, com responsavel sugerido por cada acao)

Seja decisivo. Nao fique em cima do muro. O objetivo e uma decisao clara e fundamentada.`
}

// ─── Parliament Mode IPC Handler ─────────────────────────────────────────────
ipcMain.handle('parliament-debate', async (event, { problem, roles, coordinator }) => {
  // Run all role agents in parallel
  const rolePromises = roles.map(async (role) => {
    const systemPrompt = PARLIAMENT_ROLE_PROMPTS[role.id] || `Voce e ${role.name}. Analise o problema com seu papel especifico.`
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `PROBLEMA / QUESTAO:\n\n${problem}` }
    ]
    try {
      const response = await callProviderOnce({
        provider: role.provider,
        apiKey: role.apiKey || '',
        model: role.model,
        messages,
        modalHostname: role.modalHostname
      })
      const result = { roleId: role.id, roleName: role.name, emoji: role.emoji, response, status: 'done' }
      if (win && !win.isDestroyed()) {
        win.webContents.send('parliament-role-done', result)
      }
      return result
    } catch (err) {
      const result = { roleId: role.id, roleName: role.name, emoji: role.emoji, response: '', error: err.message, status: 'error' }
      if (win && !win.isDestroyed()) {
        win.webContents.send('parliament-role-done', result)
      }
      return result
    }
  })

  const roleResults = await Promise.all(rolePromises)

  // Notify frontend that coordinator is starting
  if (win && !win.isDestroyed()) {
    win.webContents.send('parliament-coordinator-start', {})
  }

  // Build coordinator context
  const rolesContext = roleResults.map(r =>
    `## ${r.emoji} ${r.roleName}\n\n${r.response || `[Erro: ${r.error || 'sem resposta'}]`}`
  ).join('\n\n---\n\n')

  const coordinatorMessages = [
    { role: 'system', content: PARLIAMENT_ROLE_PROMPTS.coordenador },
    { role: 'user', content: `PROBLEMA ORIGINAL:\n\n${problem}\n\n${'='.repeat(60)}\n\nCONTRIBUICAO DOS ESPECIALISTAS:\n\n${rolesContext}` }
  ]

  let coordinatorResponse = ''
  try {
    coordinatorResponse = await callProviderOnce({
      provider: coordinator.provider,
      apiKey: coordinator.apiKey || '',
      model: coordinator.model,
      messages: coordinatorMessages,
      modalHostname: coordinator.modalHostname
    })
  } catch (err) {
    coordinatorResponse = `Erro no Coordenador: ${err.message}`
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('parliament-coordinator-done', { response: coordinatorResponse })
  }

  return { roles: roleResults, coordinator: coordinatorResponse }
})


// ═══════════════════════════════════════════════════════════════════════════
// v1.8.0 — Tier 1+2+3 Feature Backends
// ═══════════════════════════════════════════════════════════════════════════

// ─── Data paths ──────────────────────────────────────────────────────────────
const VAULT_PATH      = path.join(app.getPath('userData'), 'prompt-vault.json')
const RAG_INDEX_PATH  = path.join(app.getPath('userData'), 'rag-index.json')
const ARENA_PATH      = path.join(app.getPath('userData'), 'arena-scores.json')
const WORKFLOWS_PATH  = path.join(app.getPath('userData'), 'workflows.json')
const PERSONAS_PATH   = path.join(app.getPath('userData'), 'personas.json')
const SKILLS_PATH     = path.join(app.getPath('userData'), 'skills.json')

// ─── Prompt Vault ────────────────────────────────────────────────────────────
ipcMain.handle('vault-load', async () => {
  try {
    if (fs.existsSync(VAULT_PATH)) return { prompts: JSON.parse(fs.readFileSync(VAULT_PATH, 'utf-8')) }
    return { prompts: [] }
  } catch (e) { return { prompts: [], error: e.message } }
})

ipcMain.handle('vault-save', async (event, prompts) => {
  try { atomicWriteJSON(VAULT_PATH, prompts); return { error: null } }
  catch (e) { return { error: e.message } }
})

// ─── Persona Engine ──────────────────────────────────────────────────────────
ipcMain.handle('persona-load', async () => {
  try {
    if (fs.existsSync(PERSONAS_PATH)) return { personas: JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf-8')) }
    return { personas: [] }
  } catch (e) { return { personas: [], error: e.message } }
})

ipcMain.handle('persona-save', async (event, personas) => {
  try { atomicWriteJSON(PERSONAS_PATH, personas); return { error: null } }
  catch (e) { return { error: e.message } }
})

// ─── Skills (capacidades invocadas pelo modelo, v2.27.0) ──────────────────────
ipcMain.handle('skill-load', async () => {
  try {
    if (fs.existsSync(SKILLS_PATH)) return { skills: JSON.parse(fs.readFileSync(SKILLS_PATH, 'utf-8')) }
    return { skills: [] }
  } catch (e) { return { skills: [], error: e.message } }
})

ipcMain.handle('skill-save', async (event, skills) => {
  try { atomicWriteJSON(SKILLS_PATH, skills); return { error: null } }
  catch (e) { return { error: e.message } }
})

// ─── Model Arena ─────────────────────────────────────────────────────────────
ipcMain.handle('arena-load', async () => {
  try {
    if (fs.existsSync(ARENA_PATH)) return { scores: JSON.parse(fs.readFileSync(ARENA_PATH, 'utf-8')) }
    return { scores: [] }
  } catch (e) { return { scores: [], error: e.message } }
})

ipcMain.handle('arena-save', async (event, scores) => {
  try { atomicWriteJSON(ARENA_PATH, scores); return { error: null } }
  catch (e) { return { error: e.message } }
})

// ─── Workflow Builder ─────────────────────────────────────────────────────────
ipcMain.handle('workflow-load', async () => {
  try {
    if (fs.existsSync(WORKFLOWS_PATH)) return { workflows: JSON.parse(fs.readFileSync(WORKFLOWS_PATH, 'utf-8')) }
    return { workflows: [] }
  } catch (e) { return { workflows: [], error: e.message } }
})

ipcMain.handle('workflow-save', async (event, workflows) => {
  try { atomicWriteJSON(WORKFLOWS_PATH, workflows); return { error: null } }
  catch (e) { return { error: e.message } }
})

// ─── Code Workspace: Recursive directory tree ─────────────────────────────────
ipcMain.handle('workspace-tree', async (event, dirPath) => {
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'release', 'build', '.cache', '__pycache__'])
  function buildTree(p, depth = 0) {
    if (depth > 6) return []
    try {
      return fs.readdirSync(p, { withFileTypes: true })
        .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.') && !e.name.endsWith('.tsbuildinfo'))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })
        .map(e => ({
          name: e.name,
          path: path.join(p, e.name),
          type: e.isDirectory() ? 'dir' : 'file',
          children: e.isDirectory() ? buildTree(path.join(p, e.name), depth + 1) : undefined
        }))
    } catch { return [] }
  }
  try {
    return { tree: buildTree(dirPath), error: null }
  } catch (e) {
    return { tree: [], error: e.message }
  }
})

// ─── RAG Local: Ollama embeddings + cosine similarity ────────────────────────
ipcMain.handle('rag-embed', async (event, { model, text }) => {
  return new Promise((resolve) => {
    const body = JSON.stringify({ model, input: text })
    const opts = {
      hostname: 'localhost', port: 11434,
      path: '/api/embed', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD)
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const embedding = parsed.embeddings?.[0] || parsed.embedding || []
          resolve({ embedding, error: embedding.length ? null : 'Modelo sem suporte a embeddings' })
        } catch (e) { resolve({ embedding: [], error: e.message }) }
      })
    })
    req.on('error', e => resolve({ embedding: [], error: `Ollama offline: ${e.message}` }))
    req.write(body)
    req.end()
  })
})

ipcMain.handle('rag-index-load', async () => {
  try {
    if (fs.existsSync(RAG_INDEX_PATH)) return { chunks: JSON.parse(fs.readFileSync(RAG_INDEX_PATH, 'utf-8')) }
    return { chunks: [] }
  } catch (e) { return { chunks: [], error: e.message } }
})

ipcMain.handle('rag-index-save', async (event, chunks) => {
  try { atomicWriteJSON(RAG_INDEX_PATH, chunks, false); return { error: null } }
  catch (e) { return { error: e.message } }
})

ipcMain.handle('rag-search', async (event, { queryEmbedding, topK = 5 }) => {
  try {
    if (!fs.existsSync(RAG_INDEX_PATH)) return { results: [] }
    const chunks = JSON.parse(fs.readFileSync(RAG_INDEX_PATH, 'utf-8'))
    if (!chunks.length) return { results: [] }

    function cosineSim(a, b) {
      let dot = 0, na = 0, nb = 0
      const len = Math.min(a.length, b.length)
      for (let i = 0; i < len; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
      return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
    }

    const scored = chunks
      .filter(c => c.embedding && c.embedding.length > 0)
      .map(c => ({ text: c.content, source: c.source, score: cosineSim(queryEmbedding, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    return { results: scored }
  } catch (e) { return { results: [], error: e.message } }
})

ipcMain.handle('rag-clear', async () => {
  try { atomicWriteJSON(RAG_INDEX_PATH, [], false); return { error: null } }
  catch (e) { return { error: e.message } }
})

// Estatísticas LEVES do índice (contagem + fontes únicas, SEM os embeddings) —
// usado pelo chat (App→useChat) para saber se há base e montar a regra de
// roteamento do rag_search no system prompt (fusão do RAGPanel, v2.73.0). Não
// devolve vetores: barato o suficiente para ler ao abrir e ao fechar o painel.
ipcMain.handle('rag-stats', async () => {
  try {
    if (!fs.existsSync(RAG_INDEX_PATH)) return { count: 0, sources: [] }
    const chunks = JSON.parse(fs.readFileSync(RAG_INDEX_PATH, 'utf-8'))
    if (!Array.isArray(chunks) || !chunks.length) return { count: 0, sources: [] }
    const sources = [...new Set(chunks.map(c => c && c.source).filter(Boolean))]
    return { count: chunks.length, sources }
  } catch (e) { return { count: 0, sources: [], error: e.message } }
})

// ─── Vision Mode: Screen Capture ─────────────────────────────────────────────
ipcMain.handle('capture-screen', async () => {
  try {
    const { desktopCapturer, screen } = require('electron')
    const display = screen.getPrimaryDisplay()
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.bounds.width, height: display.bounds.height }
    })
    if (!sources.length) return { base64: null, error: 'Nenhuma fonte de tela encontrada' }
    const dataUrl = sources[0].thumbnail.toDataURL()
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    return { base64, error: null }
  } catch (e) { return { base64: null, error: e.message } }
})

// Vision Chat — sends image + prompt to any provider
ipcMain.handle('vision-chat', async (event, { provider, apiKey, model, prompt, imageBase64, modalHostname }) => {
  return new Promise((resolve) => {
    if (provider === 'ollama') {
      // Ollama native API for vision models (llava, bakllava, etc.)
      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
        stream: false
      })
      const opts = {
        hostname: 'localhost', port: 11434,
        path: '/api/chat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }
      const req = http.request(opts, (res) => {
        let data = ''
        res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD)
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve({ response: JSON.parse(data).message?.content || '', error: null }) }
          catch (e) { resolve({ response: null, error: e.message }) }
        })
      })
      req.on('error', e => resolve({ response: null, error: e.message }))
      req.write(body)
      req.end()
      return
    }

    let hostname, apiPath, headers, bodyObj

    if (provider === 'openai' || provider === 'openrouter' || provider === 'modal') {
      hostname = provider === 'openai' ? 'api.openai.com'
                : provider === 'openrouter' ? 'openrouter.ai'
                : (modalHostname || 'api.us-west-2.modal.direct')
      apiPath = provider === 'openrouter' ? '/api/v1/chat/completions' : '/v1/chat/completions'
      headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/mrtjr/openclaude-desktop', 'X-Title': 'OpenClaude Desktop' } : {})
      }
      bodyObj = {
        model, stream: false, max_tokens: 2048, temperature: 0.7,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' } },
            { type: 'text', text: prompt }
          ]
        }]
      }
    } else if (provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com'
      apiPath = `/v1beta/models/${model}:generateContent?key=${apiKey}`
      headers = { 'Content-Type': 'application/json' }
      bodyObj = {
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: imageBase64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      }
    } else if (provider === 'anthropic') {
      hostname = 'api.anthropic.com'
      apiPath = '/v1/messages'
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      bodyObj = {
        model, max_tokens: 2048, temperature: 0.7,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      }
    } else {
      return resolve({ response: null, error: `Provider "${provider}" não suportado para visão` })
    }

    const body = JSON.stringify(bodyObj)
    const reqOpts = { hostname, path: apiPath, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }
    const req = https.request(reqOpts, (res) => {
      let data = ''
      res.setEncoding('utf8') // decode UTF-8 com estado entre chunks (evita ç/ã/é → U+FFFD)
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) return resolve({ response: null, error: `API ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 200)}` })
          let text = ''
          if (provider === 'gemini') {
            text = (parsed.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
          } else if (provider === 'anthropic') {
            text = (parsed.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
          } else {
            text = parsed.choices?.[0]?.message?.content || ''
          }
          resolve({ response: text, error: null })
        } catch (e) { resolve({ response: null, error: e.message }) }
      })
    })
    req.on('error', e => resolve({ response: null, error: e.message }))
    req.write(body)
    req.end()
  })
})

// ─── OAuth (Supabase Google PKCE loopback) ────────────────────────────────────
const { startGoogleOAuth } = require('./oauth-loopback')
ipcMain.handle('oauth-google-start', async (_e, params) => {
  try {
    return await startGoogleOAuth(params || {})
  } catch (e) {
    return { error: e.message || String(e) }
  }
})

// ─── v2.12.0: Native Notifications ────────────────────────────────────────────
// Renderer fires this when the window is blurred and a response completes.
// Click brings the window forward — mirrors what Slack / Discord do so the
// user can get back to the conversation without hunting taskbars.
const { Notification } = require('electron')
ipcMain.handle('show-notification', async (_e, opts = {}) => {
  try {
    if (!Notification.isSupported()) return { ok: false, error: 'not supported' }
    const n = new Notification({
      title: opts.title || 'OpenClaude',
      body: opts.body || '',
      silent: opts.silent === true,
      // Icon is optional — electron-builder packages an ico, but Notification
      // expects a platform-native path at runtime. Skipping keeps it simple;
      // Windows shows the app tile icon automatically.
    })
    n.on('click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
    n.show()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('is-window-focused', async () => {
  try { return { focused: !!(win && !win.isDestroyed() && win.isFocused()) } }
  catch { return { focused: false } }
})

// ─── ORION: Computer Control Agent ────────────────────────────────────────────
ipcMain.handle('orion-capture', async () => {
  try {
    const { desktopCapturer, screen } = require('electron')
    const display = screen.getPrimaryDisplay()
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.min(display.bounds.width, 1280), height: Math.min(display.bounds.height, 720) }
    })
    if (!sources.length) return { base64: null, error: 'Nenhuma fonte de tela' }
    const base64 = sources[0].thumbnail.toDataURL().replace(/^data:image\/\w+;base64,/, '')
    return { base64, error: null }
  } catch (e) { return { base64: null, error: e.message } }
})

ipcMain.handle('orion-run-action', async (event, { type, params }) => {
  const { exec: execChild } = require('child_process')

  // Montagem SEGURA do script (v2.111.0): escapes contra injeção PowerShell
  // ($()/$var), SendKeys e args do open_app vivem em electron/orion-script.js
  // (puro + testado). main.js só escreve e executa.
  const script = buildOrionScript(type, params || {})
  if (script === null) return { output: `Ação '${type}' não reconhecida`, error: null }

  const scriptPath = path.join(os.tmpdir(), `orion_${Date.now()}.ps1`)
  return new Promise((resolve) => {
    try {
      fs.writeFileSync(scriptPath, script, 'utf-8')
      execChild(`powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "${scriptPath}"`, { timeout: 15000 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(scriptPath) } catch (e) { /* temp script cleanup, best-effort */ }
        if (err && !stdout && !stderr) return resolve({ output: '', error: err.message })
        resolve({ output: (stdout || stderr || 'OK').trim(), error: null })
      })
    } catch (e) { resolve({ output: '', error: e.message }) }
  })
})


// ─── Load external IPC modules ──────────────────────────────────────
require('./ipc-agent-memory')(ipcMain, app)
require('./ipc-document')(ipcMain, app, dialog)

// ─── App lifecycle ───────────────────────────────────────────────────
// Single-instance lock — this app hides to the tray on close (window.on
// 'close' → preventDefault + hide) and has a global show hotkey, so launching
// it again while it's running hidden would otherwise spin up a SECOND Electron
// instance with its own window and IPC handlers. Both instances would write to
// the same conversations.json / memory.json / vault.json with no coordination,
// and last-writer-wins would silently clobber one window's work (e.g. a long
// agent session). Refuse the duplicate and surface the running window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

// ─── Servidor remoto p/ o app do celular (PWA) — v2.191.0 ───────────────────
// Roda aqui no MAIN: transporte HTTP + autenticação + serve a PWA (mobile/). As
// CHAVES de API e o motor de chat vivem no RENDERER (provider-chat recebe apiKey
// como parâmetro; settings no localStorage). Por isso o chat é processado por
// PONTE: o servidor manda 'remote-chat-request' p/ a janela, o renderer roda com
// a config já existente do usuário e responde 'remote-chat-reply'. Exposição à
// internet via Tailscale (`tailscale serve`), nunca port-forward; token aleatório
// protege toda rota /api. Ver electron/remote-server.js (helpers testados).
const REMOTE_TOKEN_PATH = path.join(app.getPath('userData'), 'remote-token.txt')
let remoteServer = null
let remoteToken = ''
let remoteConfig = { name: 'OpenClaude', version: app.getVersion(), provider: null, model: null, models: [] }
const remotePending = new Map() // id -> { resolve, timer }
let remoteSeq = 0

function loadOrCreateRemoteToken() {
  try { const t = fs.readFileSync(REMOTE_TOKEN_PATH, 'utf8').trim(); if (t) return t } catch { /* ainda não existe */ }
  const t = generateToken()
  try { fs.writeFileSync(REMOTE_TOKEN_PATH, t, { encoding: 'utf8', mode: 0o600 }) } catch (e) { console.error('[remote] persistir token:', e) }
  return t
}

// A ponte: encaminha o pedido do celular ao renderer e aguarda a resposta (com
// timeout — agente/modelo lento não pode pendurar a conexão do celular p/ sempre).
function remoteChatHandler(payload) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve({ error: 'O app desktop não está aberto no PC.' })
    const id = `rc${++remoteSeq}`
    const timer = setTimeout(() => {
      if (remotePending.has(id)) { remotePending.delete(id); resolve({ error: 'Tempo limite: o desktop não respondeu.' }) }
    }, 180000)
    remotePending.set(id, { resolve, timer })
    try { win.webContents.send('remote-chat-request', { id, ...payload }) }
    catch (e) { clearTimeout(timer); remotePending.delete(id); resolve({ error: 'Falha ao falar com o desktop: ' + (e.message || e) }) }
  })
}
ipcMain.on('remote-chat-reply', (_e, payload = {}) => {
  const { id, text, error, model } = payload
  const p = remotePending.get(id)
  if (!p) return
  clearTimeout(p.timer); remotePending.delete(id)
  p.resolve({ text, error, model })
})

function getRemoteServer() {
  if (!remoteServer) {
    if (!remoteToken) remoteToken = loadOrCreateRemoteToken()
    remoteServer = createRemoteServer({
      staticDir: path.join(__dirname, '..', 'mobile'),
      getToken: () => remoteToken,
      getInfo: () => ({ name: remoteConfig.name, version: remoteConfig.version, provider: remoteConfig.provider, model: remoteConfig.model, models: remoteConfig.models }),
      chatHandler: remoteChatHandler,
    })
  }
  return remoteServer
}

// IPs locais (LAN + Tailscale) p/ a UI montar as URLs de pareamento. Tailscale
// usa a faixa 100.64/10 (CGNAT) — marcamos p/ recomendar essa na UI.
function localAddresses() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        out.push({ address: ni.address, iface: name, tailscale: /^100\./.test(ni.address) || /tailscale/i.test(name) })
      }
    }
  }
  return out
}

ipcMain.handle('remote-server-start', async (_e, { port } = {}) => {
  try {
    const srv = getRemoteServer()
    const r = await srv.start(port || 8765)
    return { ok: true, port: r.port, token: remoteToken, addresses: localAddresses() }
  } catch (e) { return { error: (e && e.message) || String(e) } }
})
ipcMain.handle('remote-server-stop', async () => {
  try { if (remoteServer) await remoteServer.stop(); return { ok: true } }
  catch (e) { return { error: (e && e.message) || String(e) } }
})
ipcMain.handle('remote-server-status', async () => ({
  running: !!(remoteServer && remoteServer.isRunning()),
  port: remoteServer ? remoteServer.port() : 0,
  token: remoteToken || '',
  addresses: localAddresses(),
}))
// O renderer espelha aqui o provider/modelo/lista p/ o /api/info do celular.
ipcMain.handle('remote-server-config', async (_e, cfg = {}) => {
  remoteConfig = {
    name: 'OpenClaude',
    version: app.getVersion(),
    provider: cfg.provider != null ? String(cfg.provider) : remoteConfig.provider,
    model: cfg.model != null ? String(cfg.model) : remoteConfig.model,
    models: Array.isArray(cfg.models) ? cfg.models.slice(0, 100).map(String) : remoteConfig.models,
  }
  return { ok: true }
})
// Revoga o pareamento atual: gera um token novo (os celulares antigos param).
ipcMain.handle('remote-server-regen-token', async () => {
  remoteToken = generateToken()
  try { fs.writeFileSync(REMOTE_TOKEN_PATH, remoteToken, { encoding: 'utf8', mode: 0o600 }) } catch (e) { console.error('[remote] regen token:', e) }
  return { token: remoteToken }
})

app.whenReady().then(() => {
  // The duplicate instance is on its way out — never create a window or touch
  // the data files from it.
  if (!gotSingleInstanceLock) return
  createWindow()
  createTray()

  // Background auto-update (Claude-style). Wires events + polls GitHub Releases
  // in packaged builds; the renderer shows a "Reiniciar para atualizar" button
  // when a download is ready. Guarded so a broken updater never blocks startup.
  try { initAutoUpdater(() => win, app.isPackaged) } catch (e) { console.error('[updater] init failed:', e) }

  // Global hotkey: Ctrl+Shift+Space
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (win) { win.show(); win.focus() }
    })
  } catch (e) {
    console.error('Failed to register global shortcut:', e)
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  // Close all browser automation tabs
  for (const [id, bw] of browserTabs) {
    if (!bw.isDestroyed()) bw.close()
  }
  browserTabs.clear()
  // Para o servidor remoto (libera a porta; celulares perdem a conexão).
  if (remoteServer) { try { remoteServer.stop() } catch { /* best-effort */ } }
})
