const { app, BrowserWindow, ipcMain, shell, Tray, Menu, globalShortcut, dialog, nativeImage } = require('electron')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

const isDev = process.env.NODE_ENV === 'development'

let win = null
let tray = null

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
            try { event.sender.send('ollama-stream-chunk', { done: true }) } catch {}
            continue
          }
          try {
            const parsed = JSON.parse(jsonStr)
            event.sender.send('ollama-stream-chunk', parsed)
          } catch {}
        }
      })

      res.on('end', () => {
        // Process remaining buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim()
          if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
            try {
              const parsed = JSON.parse(trimmed.slice(6))
              event.sender.send('ollama-stream-chunk', parsed)
            } catch {}
          }
        }
        event.sender.send('ollama-stream-chunk', { done: true })
        resolve({ ok: true })
      })
    })

    req.on('error', (err) => {
      event.sender.send('ollama-stream-chunk', { done: true, error: err.message })
      reject(err)
    })
    req.write(body)
    req.end()
  })
})

// ─── IPC: Execute command ────────────────────────────────────────────
ipcMain.handle('exec-command', async (event, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, { shell: 'powershell.exe', timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', error: err?.message || null })
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

// ─── IPC: Web search (DuckDuckGo) ───────────────────────────────────
ipcMain.handle('web-search', async (event, query) => {
  return new Promise((resolve) => {
    const https = require('https')
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
    https.get(url, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          let text = ''
          if (result.AbstractText) text += `Abstract: ${result.AbstractText}\n`
          if (result.AbstractSource) text += `Source: ${result.AbstractSource}\n`
          if (result.AbstractURL) text += `URL: ${result.AbstractURL}\n`
          if (result.RelatedTopics && result.RelatedTopics.length > 0) {
            text += '\nRelated Topics:\n'
            for (const topic of result.RelatedTopics.slice(0, 5)) {
              if (topic.Text) text += `- ${topic.Text}\n`
              if (topic.FirstURL) text += `  URL: ${topic.FirstURL}\n`
            }
          }
          resolve({ result: text || 'No results found.', error: null })
        } catch (e) {
          resolve({ result: null, error: e.message })
        }
      })
    }).on('error', (e) => {
      resolve({ result: null, error: e.message })
    })
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
    const defaultRepo = 'OpenClaude/openclaude-desktop' // Repositorio placeholder, trocar para o oficial depois
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
