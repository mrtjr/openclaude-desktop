const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // ── Ollama ────────────────────────────────────────────────────────
  compactContext:   (params) => ipcRenderer.invoke('compact-context', params),
  ollamaChat:       (params) => ipcRenderer.invoke('ollama-chat', params),
  ollamaChatStream: (params) => ipcRenderer.invoke('ollama-chat-stream', params),
  onStreamChunk: (callback) => {
    const handler = (event, chunk) => callback(chunk)
    ipcRenderer.on('ollama-stream-chunk', handler)
    return () => ipcRenderer.removeListener('ollama-stream-chunk', handler)
  },
  listModels: () => ipcRenderer.invoke('list-models'),

  // ── Commands & Files ──────────────────────────────────────────────
  // NOTE: exec-command enforces a server-side whitelist.
  // Commands not in the whitelist are silently blocked and logged.
  execCommand:   (cmd)    => ipcRenderer.invoke('exec-command', cmd),
  gitCommand:    (params) => ipcRenderer.invoke('git-command', params),
  readFile:      (path)   => ipcRenderer.invoke('read-file', path),
  // NOTE: write-file is restricted to user home, documents and desktop dirs.
  writeFile:     (params) => ipcRenderer.invoke('write-file', params),
  undoLastWrite: ()       => ipcRenderer.invoke('undo-last-write'),
  listSnapshots: ()       => ipcRenderer.invoke('list-snapshots'),

  // ── Conversations ─────────────────────────────────────────────────
  saveConversations: (data) => ipcRenderer.invoke('save-conversations', data),
  loadConversations: ()     => ipcRenderer.invoke('load-conversations'),

  // ── Tools ─────────────────────────────────────────────────────────
  webSearch:      (query)  => ipcRenderer.invoke('web-search', query),
  listDirectory:  (path)   => ipcRenderer.invoke('list-directory', path),
  openTarget:     (target) => ipcRenderer.invoke('open-target', target),

  // ── Ollama status ─────────────────────────────────────────────────
  checkOllamaStatus: () => ipcRenderer.invoke('check-ollama-status'),

  // ── Auto-start ────────────────────────────────────────────────────
  getAutoStart:  ()        => ipcRenderer.invoke('get-auto-start'),
  setAutoStart:  (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

  // ── Dialogs ───────────────────────────────────────────────────────
  saveDialog:      (opts) => ipcRenderer.invoke('save-dialog', opts),
  readDroppedFile: (path) => ipcRenderer.invoke('read-dropped-file', path),

  // ── Window controls ───────────────────────────────────────────────
  minimize:    () => ipcRenderer.invoke('window-minimize'),
  maximize:    () => ipcRenderer.invoke('window-maximize'),
  close:       () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // ── Updates ───────────────────────────────────────────────────────
  checkForUpdates: () => ipcRenderer.invoke('check-update'),

  // ── Stream control ────────────────────────────────────────────────
  abortStream: () => ipcRenderer.invoke('abort-stream'),

  // ── Memory system ─────────────────────────────────────────────────
  loadMemory: ()     => ipcRenderer.invoke('load-memory'),
  saveMemory: (data) => ipcRenderer.invoke('save-memory', data),

  // ── Multi-provider AI ─────────────────────────────────────────────
  providerChat:       (params) => ipcRenderer.invoke('provider-chat', params),
  listProviderModels: (params) => ipcRenderer.invoke('list-provider-models', params),

  // ── Secure credentials (replaces localStorage for API keys) ───────
  // Use these instead of localStorage.setItem for sensitive keys.
  credentialsLoad:       ()      => ipcRenderer.invoke('credentials-load'),
  credentialsSave:       (data)  => ipcRenderer.invoke('credentials-save', data),
  credentialsDelete:     (key)   => ipcRenderer.invoke('credentials-delete', key),
  credentialsIsAvailable:()      => ipcRenderer.invoke('credentials-is-available'),

  // ── Browser automation ────────────────────────────────────────────
  // NOTE: browser-evaluate enforces a safety filter blocking cookies,
  // localStorage, fetch, eval and other dangerous APIs.
  browserLaunch:     ()       => ipcRenderer.invoke('browser-launch'),
  browserNavigate:   (url)    => ipcRenderer.invoke('browser-navigate', url),
  browserScreenshot: ()       => ipcRenderer.invoke('browser-screenshot'),
  browserGetText:    ()       => ipcRenderer.invoke('browser-get-text'),
  browserClick:      (sel)    => ipcRenderer.invoke('browser-click', sel),
  browserType:       (params) => ipcRenderer.invoke('browser-type', params),
  browserEvaluate:   (code)   => ipcRenderer.invoke('browser-evaluate', code),
  browserClose:      ()       => ipcRenderer.invoke('browser-close'),

  // ── MCP client ────────────────────────────────────────────────────
  // NOTE: mcp-connect only allows: npx, node, python, python3, uvx, deno, bun
  mcpConnect:        (params) => ipcRenderer.invoke('mcp-connect', params),
  mcpCallTool:       (params) => ipcRenderer.invoke('mcp-call-tool', params),
  mcpDisconnect:     (id)     => ipcRenderer.invoke('mcp-disconnect', id),
  mcpListConnections:()       => ipcRenderer.invoke('mcp-list-connections'),

  // ── Collaborative agents ──────────────────────────────────────────
  parallelChat: (params) => ipcRenderer.invoke('parallel-chat', params),

  // ── Audit log ─────────────────────────────────────────────────────
  auditLogAppend: (entry) => ipcRenderer.invoke('audit-log-append', entry),
  auditLogLoad:   ()      => ipcRenderer.invoke('audit-log-load'),
  auditLogClear:  ()      => ipcRenderer.invoke('audit-log-clear'),

  // ── Analytics ─────────────────────────────────────────────────────
  analyticsSaveSession: (data) => ipcRenderer.invoke('analytics-save-session', data),
  analyticsLoad:        ()     => ipcRenderer.invoke('analytics-load'),
  analyticsGetInsights: ()     => ipcRenderer.invoke('analytics-get-insights'),
  analyticsClear:       ()     => ipcRenderer.invoke('analytics-clear'),
})
