const { app, BrowserWindow, ipcMain, shell, Tray, Menu, globalShortcut, dialog, nativeImage } = require('electron')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')

const os = require('os')

const isDev = process.env.NODE_ENV === 'development'

let win = null
let tray = null
let activeOllamaStream = null
let activeProviderStream = null

// ─── Path safety check ─────────────────────────────────────────────
function isPathSafe(filePath) {
  const resolved = path.resolve(filePath)
  const home = os.homedir()
  const blocked = [
    path.join(home, '.ssh'),
    path.join(home, '.gnupg'),
    path.join(home, '.aws'),
    path.join(home, '.config', 'gcloud'),
    path.join(home, '.env'),
  ]
  if (process.platform === 'win32') {
    blocked.push('C:\\Windows\\System32', 'C:\\Windows\\SysWOW64')
  } else {
    blocked.push('/etc/shadow', '/etc/passwd')
  }
  for (const b of blocked) {
    if (resolved.toLowerCase().startsWith(b.toLowerCase())) return false
  }
  return true
}

const CONVERSATIONS_PATH = path.join(app.getPath('userData'), 'conversations.json')
const ANALYTICS_PATH = path.join(app.getPath('userData'), 'analytics.json')
const AUDIT_LOG_PATH = path.join(app.getPath('userData'), 'audit-log.json')

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

  // ─── Window controls ────────────────────────────────────────
  ipcMain.handle('window-minimize', () => win.minimize())
  ipcMain.handle('window-maximize', () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window-close', () => win.hide())
  ipcMain.handle('window-is-maximized', () => win.isMaximized())
}

// ─── IPC: Context Compaction (summarize old messages via model) ──────
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
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode && res.statusCode >= 400) {
            resolve({ error: parsed.error || `Ollama HTTP ${res.statusCode}` })
          } else {
            resolve(parsed)
          }
        }
        catch (e) { resolve({ error: `Ollama response parse error: ${e.message}` }) }
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
      // Check HTTP status for Ollama errors
      if (res.statusCode && res.statusCode >= 400) {
        let errorBody = ''
        res.on('data', (chunk) => { errorBody += chunk.toString() })
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
ipcMain.handle('exec-command', async (event, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, {
      shell: 'powershell.exe',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
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
const fileSnapshots = [] // Stack: [{filePath, backupPath, timestamp}]

ipcMain.handle('write-file', async (event, { filePath, content }) => {
  try {
    if (!isPathSafe(filePath)) {
      return { error: 'Access denied: path is in a protected directory' }
    }
    // Auto-snapshot: save backup before overwriting
    if (fs.existsSync(filePath)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
      const backupName = `${Date.now()}_${path.basename(filePath)}`
      const backupPath = path.join(SNAPSHOTS_DIR, backupName)
      fs.copyFileSync(filePath, backupPath)
      fileSnapshots.push({ filePath, backupPath, timestamp: Date.now() })
      // Keep max 50 snapshots
      while (fileSnapshots.length > 50) {
        const old = fileSnapshots.shift()
        try { fs.unlinkSync(old.backupPath) } catch (e) { /* best-effort cleanup */ }
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
  if (fileSnapshots.length === 0) {
    return { error: 'No snapshots available', restored: null }
  }
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
ipcMain.handle('save-conversations', async (event, data) => {
  return saveConversations(data)
})

ipcMain.handle('load-conversations', async () => {
  return loadConversations()
})

// ─── IPC: Web search (DuckDuckGo HTML scraping) ─────────────────────
ipcMain.handle('web-search', async (event, query) => {
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
    const req = https.request(options, (res) => {
      // Follow redirects
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
        const text = results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`
        ).join('\n\n')
        resolve({ result: `Resultados para "${query}":\n\n${text}`, error: null })
      } else {
        // Fallback to instant answer API
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
              resolve({ result: text || `Sem resultados para "${query}".`, error: null })
            } catch { resolve({ result: `Sem resultados para "${query}".`, error: null }) }
          })
        }).on('error', () => resolve({ result: `Sem resultados para "${query}".`, error: null }))
      }
    }
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
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(data, null, 2), 'utf-8')
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
}

ipcMain.handle('load-memory', async () => loadMemory())
ipcMain.handle('save-memory', async (event, data) => saveMemory(data))

// ─── IPC: Multi-provider chat (OpenAI, Gemini, Anthropic) ──────────
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
      // Convert OpenAI messages to Gemini format (with tool call support)
      const geminiContents = messages.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'tool') {
          return { role: 'user', parts: [{ functionResponse: { name: m.name || 'tool', response: { content: m.content || '' } } }] }
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          return { role: 'model', parts: m.tool_calls.map(tc => ({ functionCall: { name: tc.function.name, args: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })() } })) }
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] }
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
          anthropicMsgs.push({ role: m.role, content: m.content || '' })
        }
      }
      // Convert OpenAI tools to Anthropic tools format
      const anthropicTools = tools?.length ? tools.map(t => ({ name: t.function.name, description: t.function.description || '', input_schema: t.function.parameters || { type: 'object', properties: {} } })) : undefined
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      bodyObj = {
        model,
        max_tokens: max_tokens || 4096,
        messages: anthropicMsgs,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        temperature: temperature ?? 0.7,
        ...(anthropicTools ? { tools: anthropicTools } : {})
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
    } else {
      return resolve({ error: `Provider "${provider}" not supported` })
    }

    const body = JSON.stringify(bodyObj)
    const reqOptions = {
      hostname,
      path: apiPath,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }

    const req = https.request(reqOptions, (res) => {
      let data = ''
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
    req.setTimeout(60000, () => { req.destroy(); resolve({ error: 'Provider request timeout after 60s' }) })
    req.write(body)
    req.end()
  })
})

// ─── IPC: Multi-provider chat STREAMING (OpenAI/OpenRouter/Modal/Anthropic) ─
ipcMain.handle('provider-chat-stream', async (event, { provider, apiKey, model, messages, tools, temperature, max_tokens, modalHostname }) => {
  return new Promise((resolve) => {
    let hostname, apiPath, headers, bodyObj

    if (provider === 'openai') {
      hostname = 'api.openai.com'
      apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      bodyObj = { model, messages, tools: tools?.length ? tools : undefined, stream: true, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'openrouter') {
      hostname = 'openrouter.ai'
      apiPath = '/api/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/mrtjr/openclaude-desktop', 'X-Title': 'OpenClaude Desktop' }
      bodyObj = { model, messages, tools: tools?.length ? tools : undefined, stream: true, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'modal') {
      hostname = modalHostname || 'api.us-west-2.modal.direct'
      apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'OpenClaude-Desktop' }
      bodyObj = { model, messages, tools: tools?.length ? tools : undefined, stream: true, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
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
          anthropicMsgs.push({ role: m.role, content: m.content || '' })
        }
      }
      const anthropicTools = tools?.length ? tools.map(t => ({ name: t.function.name, description: t.function.description || '', input_schema: t.function.parameters || { type: 'object', properties: {} } })) : undefined
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      bodyObj = { model, max_tokens: max_tokens || 4096, messages: anthropicMsgs, ...(systemMsg ? { system: systemMsg.content } : {}), temperature: temperature ?? 0.7, stream: true, ...(anthropicTools ? { tools: anthropicTools } : {}) }
    } else {
      return resolve({ error: `Provider "${provider}" does not support streaming` })
    }

    const body = JSON.stringify(bodyObj)
    const reqOptions = { hostname, path: apiPath, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }

    let doneSent = false
    const sendDone = (error) => {
      if (doneSent) return
      doneSent = true
      activeProviderStream = null
      try { event.sender.send('ollama-stream-chunk', { done: true, ...(error ? { error } : {}) }) } catch (e) { console.error('[provider-stream] sendDone error:', e) }
    }

    const req = https.request(reqOptions, (res) => {
      // Check HTTP status
      if (res.statusCode && res.statusCode >= 400) {
        let errorBody = ''
        res.on('data', (chunk) => { errorBody += chunk.toString() })
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
              if (evType === 'content_block_delta') {
                const delta = parsed.delta
                if (delta?.type === 'text_delta') {
                  event.sender.send('ollama-stream-chunk', { choices: [{ delta: { content: delta.text }, finish_reason: null }] })
                } else if (delta?.type === 'input_json_delta') {
                  const idx = parsed.index
                  if (anthropicToolAccum[idx]) anthropicToolAccum[idx].argsStr += delta.partial_json
                }
              } else if (evType === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                const idx = parsed.index
                anthropicToolAccum[idx] = { id: parsed.content_block.id, name: parsed.content_block.name, argsStr: '' }
              } else if (evType === 'message_delta' && parsed.delta?.stop_reason) {
                const toolEntries = Object.values(anthropicToolAccum)
                if (toolEntries.length > 0) {
                  const tool_calls = toolEntries.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.argsStr } }))
                  event.sender.send('ollama-stream-chunk', { choices: [{ delta: { tool_calls }, finish_reason: 'tool_calls' }] })
                }
                sendDone()
              } else if (evType === 'message_stop') {
                sendDone()
              } else if (evType === 'error') {
                sendDone(parsed.error?.message || 'Anthropic stream error')
              }
            } else {
              // OpenAI-compatible SSE — pass through directly
              event.sender.send('ollama-stream-chunk', parsed)
              if (parsed.choices?.[0]?.finish_reason) sendDone()
            }
          } catch (e) { console.error('[provider-stream] SSE parse error:', e.message) }
        }
      })

      res.on('end', () => { sendDone(); resolve({ ok: true }) })
    })

    req.on('error', (err) => { sendDone(err.message); resolve({ ok: false, error: err.message }) })
    req.setTimeout(60000, () => { req.destroy(); sendDone('Provider request timeout after 60s') })
    activeProviderStream = req
    req.write(body)
    req.end()
  })
})

// ─── IPC: List provider models (OpenRouter, OpenAI, Gemini, Anthropic) ──
ipcMain.handle('list-provider-models', async (event, { provider, apiKey, modalHostname }) => {
  return new Promise((resolve) => {
    let hostname, apiPath, headers, query = ''

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
    } else {
      return resolve({ error: `Provider "${provider}" not supported for model listing` })
    }

    const options = {
      hostname,
      path: apiPath,
      method: 'GET',
      headers
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) {
            return resolve({ error: `API error ${res.statusCode}: ${JSON.stringify(parsed)}` })
          }

          let models = []
          if (provider === 'openai' || provider === 'openrouter' || provider === 'modal') {
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

// ─── IPC: Browser Automation (Playwright) ───────────────────────────────
let browser = null
let browserPage = null

ipcMain.handle('browser-launch', async () => {
  try {
    const { chromium } = require('playwright')
    browser = await chromium.launch({ headless: false })
    const context = await browser.newContext()
    browserPage = await context.newPage()
    return { success: true }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('browser-navigate', async (event, url) => {
  if (!browserPage) return { error: 'Browser not launched' }
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
  try {
    await browserPage.click(selector, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-type', async (event, { selector, text }) => {
  if (!browserPage) return { error: 'Browser not launched' }
  try {
    await browserPage.fill(selector, text, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('browser-evaluate', async (event, code) => {
  if (!browserPage) return { error: 'Browser not launched' }
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

// ─── IPC: MCP Client ────────────────────────────────────────────────────
const mcpConnections = new Map()

ipcMain.handle('mcp-connect', async (event, { id, command, args, env }) => {
  try {
    const { spawn } = require('child_process')
    const proc = spawn(command, args || [], {
      env: { ...process.env, ...(env || {}) },
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
        } catch (e) { /* incomplete JSON chunk, ignore */ }
      }
    })

    proc.on('error', (e) => {
      mcpConnections.delete(id)
    })

    proc.on('exit', () => {
      mcpConnections.delete(id)
    })

    mcpConnections.set(id, { proc, sendRequest })

    // Initialize
    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'OpenClaude Desktop', version: '1.4.0' }
    })

    // List tools
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
    fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf-8')
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

// ─── Prompt Vault ────────────────────────────────────────────────────────────
ipcMain.handle('vault-load', async () => {
  try {
    if (fs.existsSync(VAULT_PATH)) return { prompts: JSON.parse(fs.readFileSync(VAULT_PATH, 'utf-8')) }
    return { prompts: [] }
  } catch (e) { return { prompts: [], error: e.message } }
})

ipcMain.handle('vault-save', async (event, prompts) => {
  try { fs.writeFileSync(VAULT_PATH, JSON.stringify(prompts, null, 2), 'utf-8'); return { error: null } }
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
  try { fs.writeFileSync(PERSONAS_PATH, JSON.stringify(personas, null, 2), 'utf-8'); return { error: null } }
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
  try { fs.writeFileSync(ARENA_PATH, JSON.stringify(scores, null, 2), 'utf-8'); return { error: null } }
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
  try { fs.writeFileSync(WORKFLOWS_PATH, JSON.stringify(workflows, null, 2), 'utf-8'); return { error: null } }
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
  try { fs.writeFileSync(RAG_INDEX_PATH, JSON.stringify(chunks), 'utf-8'); return { error: null } }
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
  try { fs.writeFileSync(RAG_INDEX_PATH, '[]', 'utf-8'); return { error: null } }
  catch (e) { return { error: e.message } }
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

  let script = ''
  switch (type) {
    case 'move_mouse':
      script = `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(params.x || 0)}, ${Math.round(params.y || 0)})`
      break
    case 'click': {
      const cx = Math.round(params.x || 0), cy = Math.round(params.y || 0)
      script = `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})\nAdd-Type -TypeDefinition @"\nusing System; using System.Runtime.InteropServices;\npublic class MC18 { [DllImport(\"user32.dll\")] public static extern void mouse_event(int f,int x,int y,int c,int e); }\n"@\n[MC18]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 80; [MC18]::mouse_event(4,0,0,0,0)`
      break
    }
    case 'type_text': {
      const safeText = (params.text || '').replace(/\\/g, '\\\\').replace(/"/g, '`"').replace(/\n/g, '{ENTER}').replace(/\t/g, '{TAB}')
      script = `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait("${safeText}")`
      break
    }
    case 'key_press':
      script = `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait("${params.key || '{ENTER}'}")`
      break
    case 'wait':
      script = `Start-Sleep -Milliseconds ${Math.min(params.ms || 1000, 30000)}`
      break
    case 'scroll':
      script = `Add-Type -TypeDefinition @"\nusing System; using System.Runtime.InteropServices;\npublic class SC18 { [DllImport(\"user32.dll\")] public static extern void mouse_event(int f,int x,int y,int c,int e); }\n"@\n[SC18]::mouse_event(0x0800,0,0,${(params.delta || 3) * 120},0)`
      break
    case 'open_app':
      script = `Start-Process "${(params.app || '').replace(/"/g, '')}"`
      break
    default:
      return { output: `Ação '${type}' não reconhecida`, error: null }
  }

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
app.whenReady().then(() => {
  createWindow()
  createTray()

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
})
