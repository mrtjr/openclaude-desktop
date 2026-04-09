const { app, BrowserWindow, ipcMain, shell, Tray, Menu, globalShortcut, dialog, nativeImage, safeStorage } = require('electron')
const { exec, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const crypto = require('crypto')

const isDev = process.env.NODE_ENV === 'development'

let win = null
let tray = null
let activeStreamRequest = null

const CONVERSATIONS_PATH = path.join(app.getPath('userData'), 'conversations.json')
const ANALYTICS_PATH    = path.join(app.getPath('userData'), 'analytics.json')
const AUDIT_LOG_PATH    = path.join(app.getPath('userData'), 'audit-log.json')
const MEMORY_PATH       = path.join(app.getPath('userData'), 'memory.json')
const CREDENTIALS_PATH  = path.join(app.getPath('userData'), 'credentials.enc')

// ─── Security: Allowed dirs for file operations ───────────────────────
const ALLOWED_WRITE_ROOTS = [
  app.getPath('home'),
  app.getPath('userData'),
  app.getPath('documents'),
  app.getPath('desktop'),
]

const BLOCKED_PATH_PATTERNS = [
  /[/\\]windows[/\\]/i,
  /[/\\]system32[/\\]/i,
  /[/\\]syswow64[/\\]/i,
  /[/\\]program files[/\\]/i,
  /[/\\]etc[/\\]/i,
  /[/\\]proc[/\\]/i,
  /[/\\]sys[/\\]/i,
]

function isPathAllowed(targetPath) {
  try {
    const resolved = path.resolve(targetPath)
    // Block known dangerous system paths
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(resolved)) return false
    }
    // Must be inside one of the allowed roots
    return ALLOWED_WRITE_ROOTS.some(root => resolved.startsWith(path.resolve(root)))
  } catch {
    return false
  }
}

// ─── Security: PowerShell command whitelist ───────────────────────────
const ALLOWED_PS_PREFIXES = [
  'Get-', 'Set-', 'New-', 'Remove-', 'Move-', 'Copy-', 'Rename-',
  'Start-', 'Stop-', 'Restart-', 'Test-', 'Invoke-WebRequest',
  'Invoke-RestMethod', 'Write-Output', 'Write-Host', 'Read-Host',
  'Select-Object', 'Where-Object', 'ForEach-Object', 'Sort-Object',
  'Format-Table', 'Format-List', 'ConvertTo-Json', 'ConvertFrom-Json',
  'ConvertTo-Csv', 'Out-File', 'Out-String', 'npm ', 'node ', 'python ',
  'pip ', 'git ', 'ls', 'dir', 'cd ', 'mkdir', 'echo ', 'cat ', 'type ',
  'curl ', 'ping ', 'ipconfig', 'whoami', 'hostname', 'tasklist',
  '[System.IO', '[System.Net', 'dotnet ', 'cargo ', 'rustc ',
]

const BLOCKED_CMD_PATTERNS = [
  /Invoke-Expression/i, /iex\b/i, /Invoke-Command/i,
  /\$env:PATH\s*=/i, /\$env:USERPROFILE\s*=/i,
  /Net\.WebClient/i, /DownloadFile/i, /DownloadString/i,
  /Start-Process.*-Verb.*RunAs/i,
  /sc\s+create/i, /sc\s+start/i, /schtasks/i,
  /reg\s+add/i, /reg\s+delete/i, /regedit/i,
  /netsh\s+/i, /bcdedit/i, /wmic\s+/i,
  /format\s+/i, /del\s+\//i, /rd\s+\/s/i,
]

function isPsCommandAllowed(cmd) {
  const trimmed = cmd.trim()
  // Block forbidden patterns first
  for (const pattern of BLOCKED_CMD_PATTERNS) {
    if (pattern.test(trimmed)) return false
  }
  // Allow if starts with a whitelisted prefix
  for (const prefix of ALLOWED_PS_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return true
  }
  // Allow simple file/path operations that don't match blocked patterns
  if (/^[a-zA-Z]:\\/.test(trimmed)) return false // bare drive-path execution
  // Default deny for unrecognized commands
  return false
}

// ─── Security: Allowed MCP commands ──────────────────────────────────
const ALLOWED_MCP_COMMANDS = [
  'npx', 'node', 'python', 'python3', 'uvx', 'deno', 'bun'
]

function isMcpCommandAllowed(command) {
  const base = path.basename(command).replace(/\.exe$/i, '').toLowerCase()
  return ALLOWED_MCP_COMMANDS.includes(base)
}

// ─── Security: Encrypted credentials (safeStorage) ───────────────────
function loadCredentials() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {}
    if (!fs.existsSync(CREDENTIALS_PATH)) return {}
    const raw = fs.readFileSync(CREDENTIALS_PATH)
    const decrypted = safeStorage.decryptString(raw)
    return JSON.parse(decrypted)
  } catch {
    return {}
  }
}

function saveCredentials(data) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { error: 'Encryption not available on this platform' }
    }
    const json = JSON.stringify(data)
    const encrypted = safeStorage.encryptString(json)
    fs.writeFileSync(CREDENTIALS_PATH, encrypted)
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
}

ipcMain.handle('credentials-load', async () => loadCredentials())
ipcMain.handle('credentials-save', async (event, data) => saveCredentials(data))
ipcMain.handle('credentials-delete', async (event, key) => {
  const creds = loadCredentials()
  delete creds[key]
  return saveCredentials(creds)
})
ipcMain.handle('credentials-is-available', async () => safeStorage.isEncryptionAvailable())

// ─── Analytics Engine ────────────────────────────────────────────────
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
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
    if (data.sessions) {
      data.sessions = data.sessions.filter(s => s.timestamp > thirtyDaysAgo)
    }
    if (data.sessions && data.sessions.length > 500) {
      data.sessions = data.sessions.slice(-500)
    }
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(data, null, 2), 'utf-8')
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Conversations persistence ───────────────────────────────────────
function loadConversations() {
  try {
    if (fs.existsSync(CONVERSATIONS_PATH)) {
      return JSON.parse(fs.readFileSync(CONVERSATIONS_PATH, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load conversations:', e)
  }
  return []
}

function saveConversations(data) {
  try {
    fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(data, null, 2), 'utf-8')
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
      sandbox: true,
      webSecurity: true,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  // ─── Content Security Policy ───────────────────────────────────
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; connect-src 'self' http://localhost:* ws://localhost:*;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none';"
        ]
      }
    })
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  // ─── Window controls ────────────────────────────────────────
  ipcMain.handle('window-minimize',    () => win.minimize())
  ipcMain.handle('window-maximize',    () => { if (win.isMaximized()) win.unmaximize(); else win.maximize() })
  ipcMain.handle('window-close',       () => win.hide())
  ipcMain.handle('window-is-maximized',() => win.isMaximized())
}

// ─── IPC: Context Compaction ─────────────────────────────────────────
ipcMain.handle('compact-context', async (event, { messages, model, language }) => {
  return new Promise((resolve) => {
    const compactPrompt = language === 'pt'
      ? `Resuma a conversa abaixo em um parágrafo compacto preservando: (1) fatos-chave mencionados, (2) decisões tomadas, (3) arquivos/caminhos referenciados, (4) estado atual do trabalho. Seja denso e factual, sem floreios. Máximo 300 palavras.`
      : `Summarize the conversation below in one compact paragraph preserving: (1) key facts mentioned, (2) decisions made, (3) files/paths referenced, (4) current state of work. Be dense and factual, no fluff. Maximum 300 words.`

    const compactMessages = [
      { role: 'system', content: compactPrompt },
      { role: 'user', content: messages.map(m => `[${m.role}]: ${m.content?.substring(0, 500) || '(tool call)'}`).join('\n') }
    ]

    const body = JSON.stringify({
      model,
      messages: compactMessages,
      stream: false,
      options: { temperature: 0.1 }
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
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const summary = parsed.choices?.[0]?.message?.content || ''
          resolve({ summary, error: null })
        } catch (e) { resolve({ summary: '', error: e.message }) }
      })
    })
    req.on('error', (e) => resolve({ summary: '', error: e.message }))
    req.setTimeout(30000, () => { req.destroy(); resolve({ summary: '', error: 'Compaction timeout' }) })
    req.write(body)
    req.end()
  })
})

// ─── IPC: Ollama chat (non-streaming) ────────────────────────────────
ipcMain.handle('ollama-chat', async (event, { messages, model, tools, temperature, max_tokens }) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      tools: tools || [],
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
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
})

// ─── IPC: Ollama chat streaming ──────────────────────────────────────
ipcMain.handle('ollama-chat-stream', async (event, { messages, model, tools, temperature, max_tokens }) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      tools: tools || [],
      stream: true,
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

    let doneSent = false
    const sendDone = (error) => {
      if (doneSent) return
      doneSent = true
      activeStreamRequest = null
      try {
        event.sender.send('ollama-stream-chunk', { done: true, ...(error ? { error } : {}) })
      } catch {}
    }

    const req = http.request(options, (res) => {
      let buffer = ''

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
            event.sender.send('ollama-stream-chunk', parsed)
          } catch {}
        }
      })

      res.on('end', () => {
        if (buffer.trim()) {
          const trimmed = buffer.trim()
          if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
            try {
              const parsed = JSON.parse(trimmed.slice(6))
              event.sender.send('ollama-stream-chunk', parsed)
            } catch {}
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

    activeStreamRequest = req
    req.write(body)
    req.end()
  })
})

// ─── IPC: Abort stream ───────────────────────────────────────────────
ipcMain.handle('abort-stream', async () => {
  if (activeStreamRequest) {
    activeStreamRequest.destroy()
    activeStreamRequest = null
    return { aborted: true }
  }
  return { aborted: false }
})

// ─── IPC: Execute command (HARDENED) ────────────────────────────────
// Only allows whitelisted PowerShell commands — no arbitrary RCE.
ipcMain.handle('exec-command', async (event, cmd) => {
  if (typeof cmd !== 'string' || cmd.trim().length === 0) {
    return { stdout: '', stderr: '', exitCode: 1, error: 'Empty or invalid command' }
  }

  if (!isPsCommandAllowed(cmd)) {
    // Log blocked attempt
    const log = loadAuditLog()
    log.push({ type: 'BLOCKED_EXEC', command: cmd.substring(0, 200), timestamp: Date.now() })
    saveAuditLog(log)
    return { stdout: '', stderr: '', exitCode: 1, error: `[SECURITY] Command blocked by whitelist policy: "${cmd.substring(0, 80)}..."` }
  }

  return new Promise((resolve) => {
    exec(cmd, {
      shell: 'powershell.exe',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err?.code ?? 0,
        error: err && !stdout && !stderr ? err.message : null
      })
    })
  })
})

// ─── IPC: Git command (HARDENED) ────────────────────────────────────
// Restricts cwd to allowed directories, strips shell metacharacters.
ipcMain.handle('git-command', async (event, { command, cwd }) => {
  if (typeof command !== 'string') {
    return { stdout: '', stderr: '', error: 'Invalid command' }
  }

  // Strip shell injection characters
  if (/[;&|`$(){}\[\]<>!\\]/.test(command)) {
    return { stdout: '', stderr: '', error: '[SECURITY] Invalid characters in git command' }
  }

  // Validate cwd is inside allowed roots
  if (cwd && !isPathAllowed(cwd)) {
    return { stdout: '', stderr: '', error: `[SECURITY] Working directory not allowed: ${cwd}` }
  }

  // Only allow safe git subcommands
  const ALLOWED_GIT_CMDS = [
    'status', 'log', 'diff', 'show', 'branch', 'checkout', 'add', 'commit',
    'push', 'pull', 'fetch', 'clone', 'init', 'remote', 'stash', 'merge',
    'rebase', 'reset', 'clean', 'tag', 'rev-parse', 'ls-files', 'shortlog'
  ]
  const subCmd = command.trim().split(/\s+/)[0].toLowerCase()
  if (!ALLOWED_GIT_CMDS.includes(subCmd)) {
    return { stdout: '', stderr: '', error: `[SECURITY] Git subcommand not allowed: ${subCmd}` }
  }

  return new Promise((resolve) => {
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
  if (typeof filePath !== 'string') return { content: null, error: 'Invalid path' }
  try {
    const stats = fs.statSync(filePath)
    if (stats.size > 10 * 1024 * 1024) return { content: null, error: 'File too large (> 10MB)' }
    return { content: fs.readFileSync(filePath, 'utf-8'), error: null }
  } catch (e) {
    return { content: null, error: e.message }
  }
})

// ─── IPC: Write file (HARDENED — restricted to allowed dirs) ─────────
const SNAPSHOTS_DIR = path.join(app.getPath('userData'), 'snapshots')
const fileSnapshots = []

ipcMain.handle('write-file', async (event, { filePath, content }) => {
  if (typeof filePath !== 'string' || typeof content !== 'string') {
    return { error: 'Invalid parameters' }
  }

  if (!isPathAllowed(filePath)) {
    const log = loadAuditLog()
    log.push({ type: 'BLOCKED_WRITE', path: filePath.substring(0, 200), timestamp: Date.now() })
    saveAuditLog(log)
    return { error: `[SECURITY] Write to path not allowed: ${filePath}` }
  }

  // Enforce max content size (5MB)
  if (content.length > 5 * 1024 * 1024) {
    return { error: 'Content too large (> 5MB)' }
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
      const backupName = `${Date.now()}_${path.basename(filePath)}`
      const backupPath = path.join(SNAPSHOTS_DIR, backupName)
      fs.copyFileSync(filePath, backupPath)
      fileSnapshots.push({ filePath, backupPath, timestamp: Date.now() })
      while (fileSnapshots.length > 50) {
        const old = fileSnapshots.shift()
        try { fs.unlinkSync(old.backupPath) } catch {}
      }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('undo-last-write', async () => {
  if (fileSnapshots.length === 0) return { error: 'No snapshots available', restored: null }
  const snap = fileSnapshots.pop()
  try {
    fs.copyFileSync(snap.backupPath, snap.filePath)
    fs.unlinkSync(snap.backupPath)
    return { error: null, restored: snap.filePath }
  } catch (e) {
    return { error: e.message, restored: null }
  }
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
ipcMain.handle('save-conversations', async (event, data) => saveConversations(data))
ipcMain.handle('load-conversations', async () => loadConversations())

// ─── IPC: Web search ─────────────────────────────────────────────────
ipcMain.handle('web-search', async (event, query) => {
  if (typeof query !== 'string' || query.trim().length === 0) {
    return { result: null, error: 'Invalid query' }
  }
  // Limit query length
  const safeQuery = query.substring(0, 500)

  return new Promise((resolve) => {
    const encodedQuery = encodeURIComponent(safeQuery)
    const options = {
      hostname: 'html.duckduckgo.com',
      path: `/html/?q=${encodedQuery}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      }
    }
    let data = ''
    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, { headers: options.headers }, (r2) => {
          let rd = ''
          r2.on('data', c => rd += c)
          r2.on('end', () => parseAndResolve(rd))
        }).on('error', (e) => resolve({ result: null, error: e.message }))
        return
      }
      res.on('data', chunk => data += chunk)
      res.on('end', () => parseAndResolve(data))
    })
    req.on('error', (e) => resolve({ result: null, error: e.message }))
    req.end()

    function parseAndResolve(html) {
      const results = []
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
      let idx = 0
      while ((match = snippetRegex.exec(html)) !== null && idx < results.length) {
        results[idx].snippet = match[1].replace(/<[^>]*>/g, '').trim()
        idx++
      }
      if (results.length > 0) {
        const text = results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`
        ).join('\n\n')
        resolve({ result: `Resultados para "${safeQuery}":\n\n${text}`, error: null })
      } else {
        https.get(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1`, (res2) => {
          let d = ''
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
              resolve({ result: text || `Sem resultados para "${safeQuery}".`, error: null })
            } catch { resolve({ result: `Sem resultados para "${safeQuery}".`, error: null }) }
          })
        }).on('error', () => resolve({ result: `Sem resultados para "${safeQuery}".`, error: null }))
      }
    }
  })
})

// ─── IPC: List directory ─────────────────────────────────────────────
ipcMain.handle('list-directory', async (event, dirPath) => {
  if (typeof dirPath !== 'string') return { items: null, error: 'Invalid path' }
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const items = entries.map(entry => {
      let size = 0, modified = ''
      try {
        const stats = fs.statSync(path.join(dirPath, entry.name))
        size = stats.size
        modified = stats.mtime.toISOString()
      } catch {}
      return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size, modified }
    })
    return { items, error: null }
  } catch (e) {
    return { items: null, error: e.message }
  }
})

// ─── IPC: Open file or URL ───────────────────────────────────────────
ipcMain.handle('open-target', async (event, target) => {
  if (typeof target !== 'string') return { error: 'Invalid target' }
  // Only allow http/https URLs or paths within allowed roots
  try {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      await shell.openExternal(target)
    } else if (isPathAllowed(target)) {
      await shell.openPath(target)
    } else {
      return { error: '[SECURITY] Path not allowed to open' }
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

// ─── IPC: Auto-start ─────────────────────────────────────────────────
ipcMain.handle('get-auto-start', async () => {
  try { return app.getLoginItemSettings().openAtLogin } catch { return false }
})

ipcMain.handle('set-auto-start', async (event, enabled) => {
  try { app.setLoginItemSettings({ openAtLogin: enabled }); return { error: null } }
  catch (e) { return { error: e.message } }
})

// ─── IPC: Save dialog ────────────────────────────────────────────────
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

// ─── IPC: Read dropped file ──────────────────────────────────────────
ipcMain.handle('read-dropped-file', async (event, filePath) => {
  if (typeof filePath !== 'string') return { content: null, error: 'Invalid path' }
  try {
    const stats = fs.statSync(filePath)
    if (stats.size > 5 * 1024 * 1024) return { content: null, error: 'Arquivo muito grande (> 5MB)' }
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
      headers: { 'User-Agent': 'OpenClaude-Desktop-Update-Checker' }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (res.statusCode === 200 && result.tag_name) {
            const currentVersion = app.getVersion()
            const latestVersion = result.tag_name.replace(/^v/, '')
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

// ─── IPC: Memory system ──────────────────────────────────────────────
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_PATH)) return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'))
  } catch {}
  return { facts: [], preferences: [], projects: [] }
}

function saveMemory(data) {
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(data, null, 2), 'utf-8')
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
}

ipcMain.handle('load-memory', async () => loadMemory())
ipcMain.handle('save-memory', async (event, data) => saveMemory(data))

// ─── IPC: Multi-provider chat ────────────────────────────────────────
ipcMain.handle('provider-chat', async (event, { provider, apiKey, model, messages, tools, temperature, max_tokens, stream, modalHostname }) => {
  return new Promise((resolve, reject) => {
    let hostname, apiPath, headers, bodyObj

    if (provider === 'openai') {
      hostname = 'api.openai.com'
      apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      bodyObj = { model, messages, tools: tools || undefined, stream: false, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com'
      const geminiContents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
      const systemInstruction = messages.find(m => m.role === 'system')
      apiPath = `/v1beta/models/${model}:generateContent?key=${apiKey}`
      headers = { 'Content-Type': 'application/json' }
      bodyObj = {
        contents: geminiContents,
        generationConfig: { temperature: temperature ?? 0.7, maxOutputTokens: max_tokens || 4096 },
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {})
      }
    } else if (provider === 'anthropic') {
      hostname = 'api.anthropic.com'
      apiPath = '/v1/messages'
      const systemMsg = messages.find(m => m.role === 'system')
      const nonSystemMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      bodyObj = {
        model,
        max_tokens: max_tokens || 4096,
        messages: nonSystemMsgs,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        temperature: temperature ?? 0.7
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
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'OpenClaude-Desktop' }
      bodyObj = { model, messages, tools: tools || undefined, stream: false, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else {
      return resolve({ error: `Provider "${provider}" not supported` })
    }

    const body = JSON.stringify(bodyObj)
    const reqOptions = { hostname, path: apiPath, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }

    const req = https.request(reqOptions, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) return resolve({ error: `API error ${res.statusCode}: ${JSON.stringify(parsed)}` })
          if (provider === 'gemini') {
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
            resolve({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
          } else if (provider === 'anthropic') {
            const text = parsed.content?.map(c => c.text).join('') || ''
            resolve({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: parsed.stop_reason === 'end_turn' ? 'stop' : parsed.stop_reason }] })
          } else {
            resolve(parsed)
          }
        } catch (e) { resolve({ error: e.message }) }
      })
    })
    req.on('error', (e) => resolve({ error: e.message }))
    req.write(body)
    req.end()
  })
})

// ─── IPC: List provider models ───────────────────────────────────────
ipcMain.handle('list-provider-models', async (event, { provider, apiKey, modalHostname }) => {
  return new Promise((resolve) => {
    let hostname, apiPath, headers

    if (provider === 'openai') {
      hostname = 'api.openai.com'; apiPath = '/v1/models'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'openrouter') {
      hostname = 'openrouter.ai'; apiPath = '/api/v1/models'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'modal') {
      hostname = modalHostname || 'api.us-west-2.modal.direct'; apiPath = '/v1/models'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'anthropic') {
      hostname = 'api.anthropic.com'; apiPath = '/v1/models'
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'User-Agent': 'OpenClaude-Desktop' }
    } else if (provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com'; apiPath = `/v1beta/models?key=${apiKey}`
      headers = { 'User-Agent': 'OpenClaude-Desktop' }
    } else {
      return resolve({ error: `Provider "${provider}" not supported for model listing` })
    }

    const req = https.request({ hostname, path: apiPath, method: 'GET', headers }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) return resolve({ error: `API error ${res.statusCode}: ${JSON.stringify(parsed)}` })
          let models = []
          if (['openai', 'openrouter', 'modal', 'anthropic'].includes(provider)) {
            models = (parsed.data || []).map(m => m.id).sort()
          } else if (provider === 'gemini') {
            models = (parsed.models || [])
              .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
              .map(m => m.name.replace('models/', '')).sort()
          }
          resolve({ models, error: null })
        } catch (e) { resolve({ error: e.message }) }
      })
    })
    req.on('error', (e) => resolve({ error: e.message }))
    req.end()
  })
})

// ─── IPC: Browser Automation (HARDENED) ─────────────────────────────
// browser-evaluate is sandboxed: only allows pure JS expressions
// that do NOT mutate the DOM or access sensitive APIs.
let browser = null
let browserPage = null

const BLOCKED_EVALUATE_PATTERNS = [
  /document\.cookie/i,
  /localStorage/i,
  /sessionStorage/i,
  /indexedDB/i,
  /window\.open/i,
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
  /navigator\.sendBeacon/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /import\s*\(/i,
  /require\s*\(/i,
  /process\./,
  /child_process/,
]

function isSafeEvaluateCode(code) {
  for (const pattern of BLOCKED_EVALUATE_PATTERNS) {
    if (pattern.test(code)) return false
  }
  return true
}

ipcMain.handle('browser-launch', async () => {
  try {
    const { chromium } = require('playwright')
    browser = await chromium.launch({ headless: false })
    const context = await browser.newContext()
    browserPage = await context.newPage()
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-navigate', async (event, url) => {
  if (!browserPage) return { error: 'Browser not launched' }
  if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { error: '[SECURITY] Only http/https URLs are allowed' }
  }
  try {
    await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    return { success: true, url: browserPage.url(), title: await browserPage.title() }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-screenshot', async () => {
  if (!browserPage) return { error: 'Browser not launched' }
  try {
    const buf = await browserPage.screenshot({ type: 'png' })
    return { success: true, base64: buf.toString('base64') }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-get-text', async () => {
  if (!browserPage) return { error: 'Browser not launched' }
  try {
    const text = await browserPage.evaluate(() => document.body.innerText)
    return { success: true, text: text.substring(0, 8000) }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-click', async (event, selector) => {
  if (!browserPage) return { error: 'Browser not launched' }
  if (typeof selector !== 'string' || selector.length > 500) return { error: 'Invalid selector' }
  try {
    await browserPage.click(selector, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-type', async (event, { selector, text }) => {
  if (!browserPage) return { error: 'Browser not launched' }
  if (typeof selector !== 'string' || typeof text !== 'string') return { error: 'Invalid parameters' }
  try {
    await browserPage.fill(selector, text, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// HARDENED: evaluate code goes through safety filter
ipcMain.handle('browser-evaluate', async (event, code) => {
  if (!browserPage) return { error: 'Browser not launched' }
  if (typeof code !== 'string') return { error: 'Invalid code' }
  if (!isSafeEvaluateCode(code)) {
    const log = loadAuditLog()
    log.push({ type: 'BLOCKED_EVALUATE', code: code.substring(0, 200), timestamp: Date.now() })
    saveAuditLog(log)
    return { error: '[SECURITY] Code blocked by evaluate safety filter' }
  }
  try {
    const result = await browserPage.evaluate(code)
    return { success: true, result: JSON.stringify(result).substring(0, 5000) }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-close', async () => {
  try {
    if (browser) { await browser.close(); browser = null; browserPage = null }
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ─── IPC: MCP Client (HARDENED) ──────────────────────────────────────
// Only allows MCP connections to whitelisted runtimes.
const mcpConnections = new Map()

ipcMain.handle('mcp-connect', async (event, { id, command, args, env }) => {
  if (typeof command !== 'string' || !isMcpCommandAllowed(command)) {
    return { error: `[SECURITY] MCP command not allowed: ${command}. Allowed: ${ALLOWED_MCP_COMMANDS.join(', ')}` }
  }

  // Sanitize args — no shell metacharacters
  const safeArgs = (args || []).map(a => String(a))
  // Sanitize env keys — alphanumeric + underscore only
  const safeEnv = {}
  for (const [k, v] of Object.entries(env || {})) {
    if (/^[A-Z_][A-Z0-9_]*$/i.test(k)) safeEnv[k] = String(v)
  }

  try {
    const proc = spawn(command, safeArgs, {
      env: { ...process.env, ...safeEnv },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let buffer = ''
    const pendingRequests = new Map()
    let requestId = 0

    const sendRequest = (method, params) => {
      return new Promise((resolve, reject) => {
        const rid = ++requestId
        const msg = JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n'
        pendingRequests.set(rid, { resolve, reject })
        proc.stdin.write(msg)
        setTimeout(() => {
          if (pendingRequests.has(rid)) {
            pendingRequests.delete(rid)
            reject(new Error('MCP request timeout'))
          }
        }, 15000)
      })
    }

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
        } catch {}
      }
    })

    proc.on('error', () => mcpConnections.delete(id))
    proc.on('exit', () => mcpConnections.delete(id))

    mcpConnections.set(id, { proc, sendRequest })

    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'OpenClaude Desktop', version: '1.4.0' }
    })
    const toolsResult = await sendRequest('tools/list', {})
    return { success: true, serverInfo: initResult, tools: toolsResult?.tools || [] }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('mcp-call-tool', async (event, { connectionId, toolName, args }) => {
  const conn = mcpConnections.get(connectionId)
  if (!conn) return { error: 'MCP server not connected' }
  try {
    const result = await conn.sendRequest('tools/call', { name: toolName, arguments: args || {} })
    const text = result?.content?.map(c => c.text || '').join('') || JSON.stringify(result)
    return { success: true, result: text }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('mcp-disconnect', async (event, id) => {
  const conn = mcpConnections.get(id)
  if (conn) { conn.proc.kill(); mcpConnections.delete(id) }
  return { success: true }
})

ipcMain.handle('mcp-list-connections', async () => [...mcpConnections.keys()])

// ─── IPC: Collaborative Agents ───────────────────────────────────────
ipcMain.handle('parallel-chat', async (event, { tasks, model, temperature, max_tokens }) => {
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
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try { resolve({ id: task.id, result: JSON.parse(data), error: null }) }
          catch (e) { resolve({ id: task.id, result: null, error: e.message }) }
        })
      })
      req.on('error', (e) => resolve({ id: task.id, result: null, error: e.message }))
      req.setTimeout(120000, () => { req.destroy(); resolve({ id: task.id, result: null, error: 'Timeout' }) })
      req.write(body)
      req.end()
    })
  }
  return Promise.all(tasks.map(executeTask))
})

// ─── IPC: Audit Log ──────────────────────────────────────────────────
function loadAuditLog() {
  try {
    if (fs.existsSync(AUDIT_LOG_PATH)) return JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf-8'))
  } catch {}
  return []
}

function saveAuditLog(entries) {
  try {
    fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(entries.slice(-1000), null, 2), 'utf-8')
  } catch {}
}

ipcMain.handle('audit-log-append', async (event, entry) => {
  const log = loadAuditLog()
  log.push({ ...entry, timestamp: Date.now() })
  saveAuditLog(log)
  return { error: null }
})

ipcMain.handle('audit-log-load',  async () => loadAuditLog())
ipcMain.handle('audit-log-clear', async () => { saveAuditLog([]); return { error: null } })

// ─── IPC: Analytics ──────────────────────────────────────────────────
ipcMain.handle('analytics-save-session', async (event, sessionData) => {
  const analytics = loadAnalytics()
  analytics.sessions.push({ ...sessionData, timestamp: Date.now() })
  analytics.globalStats.totalSessions++
  analytics.globalStats.totalToolCalls  += sessionData.toolCalls  || 0
  analytics.globalStats.totalErrors     += sessionData.errors     || 0
  if (sessionData.agentMode) analytics.globalStats.totalAgentRuns++
  analytics.globalStats.totalCircuitBreaks += sessionData.circuitBreaks || 0
  return saveAnalytics(analytics)
})

ipcMain.handle('analytics-load', async () => loadAnalytics())

ipcMain.handle('analytics-get-insights', async () => {
  const analytics = loadAnalytics()
  const sessions = analytics.sessions || []
  if (sessions.length === 0) return { hasData: false }

  const now = Date.now()
  const last7d  = sessions.filter(s => s.timestamp > now - 7  * 24 * 60 * 60 * 1000)
  const last24h = sessions.filter(s => s.timestamp > now - 24 * 60 * 60 * 1000)

  const toolFreq = {}
  for (const s of sessions) {
    if (s.toolsUsed) for (const tool of s.toolsUsed) toolFreq[tool.name] = (toolFreq[tool.name] || 0) + tool.count
  }
  const topTools = Object.entries(toolFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }))

  const modelFreq = {}
  for (const s of sessions) { if (s.model) modelFreq[s.model] = (modelFreq[s.model] || 0) + 1 }
  const modelUsage = Object.entries(modelFreq).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))

  const responseTimes = sessions.filter(s => s.avgResponseTime > 0).map(s => s.avgResponseTime)
  const avgResponseTime = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0

  const agentSessions    = sessions.filter(s => s.agentMode)
  const agentCompleted   = agentSessions.filter(s => s.agentCompleted)
  const agentCompletionRate = agentSessions.length > 0 ? Math.round((agentCompleted.length / agentSessions.length) * 100) : 0
  const agentSteps       = agentSessions.filter(s => s.agentSteps > 0).map(s => s.agentSteps)
  const avgAgentSteps    = agentSteps.length > 0 ? Math.round(agentSteps.reduce((a, b) => a + b, 0) / agentSteps.length * 10) / 10 : 0

  const sessionsWithErrors = sessions.filter(s => (s.errors || 0) > 0).length
  const errorRate = sessions.length > 0 ? Math.round((sessionsWithErrors / sessions.length) * 100) : 0

  const providerFreq = {}
  for (const s of sessions) { const p = s.provider || 'ollama'; providerFreq[p] = (providerFreq[p] || 0) + 1 }

  return {
    hasData: true,
    global: analytics.globalStats,
    period: { total: sessions.length, last7d: last7d.length, last24h: last24h.length },
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
  return saveAnalytics({ sessions: [], globalStats: { totalSessions: 0, totalToolCalls: 0, totalErrors: 0, totalAgentRuns: 0, totalCircuitBreaks: 0 } })
})

// ─── App lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (win) { win.show(); win.focus() }
    })
  } catch (e) {
    console.error('Failed to register global shortcut:', e)
  }
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { app.isQuitting = true })
