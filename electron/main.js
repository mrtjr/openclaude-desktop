const { app, BrowserWindow, ipcMain, shell, Tray, Menu, globalShortcut, dialog, nativeImage } = require('electron')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')

const isDev = process.env.NODE_ENV === 'development'

let win = null
let tray = null
let activeStreamRequest = null

const CONVERSATIONS_PATH = path.join(app.getPath('userData'), 'conversations.json')

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
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
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
          if (jsonStr === '[DONE]') {
            sendDone()
            continue
          }
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

// ─── IPC: Abort stream (kills HTTP request, frees GPU) ──────────────
ipcMain.handle('abort-stream', async () => {
  if (activeStreamRequest) {
    activeStreamRequest.destroy()
    activeStreamRequest = null
    return { aborted: true }
  }
  return { aborted: false }
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

// ─── IPC: Read file ──────────────────────────────────────────────────
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return { content: fs.readFileSync(filePath, 'utf-8'), error: null }
  } catch (e) {
    return { content: null, error: e.message }
  }
})

// ─── IPC: Write file ─────────────────────────────────────────────────
ipcMain.handle('write-file', async (event, { filePath, content }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
    return { error: null }
  } catch (e) {
    return { error: e.message }
  }
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
      } catch {}
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

// ─── IPC: Multi-provider chat (OpenAI, Gemini, Anthropic) ──────────
ipcMain.handle('provider-chat', async (event, { provider, apiKey, model, messages, tools, temperature, max_tokens, stream }) => {
  return new Promise((resolve, reject) => {
    let hostname, apiPath, headers, bodyObj

    if (provider === 'openai') {
      hostname = 'api.openai.com'
      apiPath = '/v1/chat/completions'
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      bodyObj = { model, messages, tools: tools || undefined, stream: false, temperature: temperature ?? 0.7, max_tokens: max_tokens || 4096 }
    } else if (provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com'
      // Convert OpenAI format to Gemini format
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
      const nonSystemMsgs = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: m.content
      }))
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      bodyObj = {
        model,
        max_tokens: max_tokens || 4096,
        messages: nonSystemMsgs,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        temperature: temperature ?? 0.7
      }
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
