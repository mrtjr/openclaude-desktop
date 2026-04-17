const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // Ollama
  compactContext: (params) => ipcRenderer.invoke('compact-context', params),
  ollamaChat: (params) => ipcRenderer.invoke('ollama-chat', params),
  ollamaChatStream: (params) => ipcRenderer.invoke('ollama-chat-stream', params),
  onStreamChunk: (callback) => {
    const handler = (event, chunk) => callback(chunk)
    ipcRenderer.on('ollama-stream-chunk', handler)
    return () => ipcRenderer.removeListener('ollama-stream-chunk', handler)
  },
  listModels: () => ipcRenderer.invoke('list-models'),

  // Commands & Files
  execCommand: (cmd) => ipcRenderer.invoke('exec-command', cmd),
  gitCommand: (params) => ipcRenderer.invoke('git-command', params),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (params) => ipcRenderer.invoke('write-file', params),
  undoLastWrite: () => ipcRenderer.invoke('undo-last-write'),
  listSnapshots: () => ipcRenderer.invoke('list-snapshots'),

  // Conversations
  saveConversations: (data) => ipcRenderer.invoke('save-conversations', data),
  loadConversations: () => ipcRenderer.invoke('load-conversations'),

  // New tools
  webSearch: (query) => ipcRenderer.invoke('web-search', query),
  listDirectory: (path) => ipcRenderer.invoke('list-directory', path),
  openTarget: (target) => ipcRenderer.invoke('open-target', target),

  // Ollama status
  checkOllamaStatus: () => ipcRenderer.invoke('check-ollama-status'),

  // Auto-start
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

  // Dialogs
  saveDialog: (opts) => ipcRenderer.invoke('save-dialog', opts),
  openFileDialog: (opts) => ipcRenderer.invoke('open-file-dialog', opts),

  // Dropped files
  readDroppedFile: (path) => ipcRenderer.invoke('read-dropped-file', path),

  // Document parsing (PDF / DOCX)
  readDocument: (filePath) => ipcRenderer.invoke('read-document', filePath),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-update'),

  // Abort stream
  abortStream: () => ipcRenderer.invoke('abort-stream'),

  // Memory system (user facts)
  loadMemory: () => ipcRenderer.invoke('load-memory'),
  saveMemory: (data) => ipcRenderer.invoke('save-memory', data),

  // Agent working memory (persistent between sessions)
  loadAgentMemory: () => ipcRenderer.invoke('load-agent-memory'),
  saveAgentMemory: (data) => ipcRenderer.invoke('save-agent-memory', data),

  // Multi-provider
  providerChat: (params) => ipcRenderer.invoke('provider-chat', params),
  providerChatStream: (params) => ipcRenderer.invoke('provider-chat-stream', params),
  listProviderModels: (params) => ipcRenderer.invoke('list-provider-models', params),

  // Browser automation (Electron BrowserWindow nativo)
  browserLaunch: (opts) => ipcRenderer.invoke('browser-launch', opts || {}),
  browserNavigate: (url) => ipcRenderer.invoke('browser-navigate', url),
  browserScreenshot: () => ipcRenderer.invoke('browser-screenshot'),
  browserGetText: (opts) => ipcRenderer.invoke('browser-get-text', opts || {}),
  browserClick: (selector) => ipcRenderer.invoke('browser-click', selector),
  browserType: (params) => ipcRenderer.invoke('browser-type', params),
  browserEvaluate: (code) => ipcRenderer.invoke('browser-evaluate', code),
  browserWait: (params) => ipcRenderer.invoke('browser-wait', params),
  browserGetLinks: () => ipcRenderer.invoke('browser-get-links'),
  browserGetForms: () => ipcRenderer.invoke('browser-get-forms'),
  browserClose: (tabId) => ipcRenderer.invoke('browser-close', tabId),
  browserTabs: () => ipcRenderer.invoke('browser-tabs'),
  browserSwitchTab: (tabId) => ipcRenderer.invoke('browser-switch-tab', tabId),
  // Computer Use (vision-based interaction like Claude/Manus)
  browserClickAt: (params) => ipcRenderer.invoke('browser-click-at', params),
  browserDoubleClickAt: (params) => ipcRenderer.invoke('browser-double-click-at', params),
  browserTypeText: (params) => ipcRenderer.invoke('browser-type-text', params),
  browserKeyPress: (params) => ipcRenderer.invoke('browser-key-press', params),
  browserScroll: (params) => ipcRenderer.invoke('browser-scroll', params),
  browserScreenshotVision: () => ipcRenderer.invoke('browser-screenshot-vision'),
  onBrowserPageLoaded: (callback) => {
    const listener = (event, data) => callback(data)
    ipcRenderer.on('browser-page-loaded', listener)
    return () => ipcRenderer.removeListener('browser-page-loaded', listener)
  },

  // MCP client
  mcpConnect: (params) => ipcRenderer.invoke('mcp-connect', params),
  mcpCallTool: (params) => ipcRenderer.invoke('mcp-call-tool', params),
  mcpDisconnect: (id) => ipcRenderer.invoke('mcp-disconnect', id),
  mcpListConnections: () => ipcRenderer.invoke('mcp-list-connections'),

  // Collaborative agents
  parallelChat: (params) => ipcRenderer.invoke('parallel-chat', params),
  providerParallelChat: (params) => ipcRenderer.invoke('provider-parallel-chat', params),

  // Parliament Mode — Multi-Agent Debate
  parliamentDebate: (params) => ipcRenderer.invoke('parliament-debate', params),
  onParliamentRoleDone: (callback) => {
    const handler = (event, result) => callback(result)
    ipcRenderer.on('parliament-role-done', handler)
    return () => ipcRenderer.removeListener('parliament-role-done', handler)
  },
  onParliamentCoordinatorDone: (callback) => {
    const handler = (event, result) => callback(result)
    ipcRenderer.on('parliament-coordinator-done', handler)
    return () => ipcRenderer.removeListener('parliament-coordinator-done', handler)
  },
  onParliamentCoordinatorStart: (callback) => {
    const handler = (event, data) => callback(data)
    ipcRenderer.on('parliament-coordinator-start', handler)
    return () => ipcRenderer.removeListener('parliament-coordinator-start', handler)
  },

  // Audit Log
  auditLogAppend: (entry) => ipcRenderer.invoke('audit-log-append', entry),
  auditLogLoad: () => ipcRenderer.invoke('audit-log-load'),
  auditLogClear: () => ipcRenderer.invoke('audit-log-clear'),

  // Analytics (MCD/MAGI/MASA)
  analyticsSaveSession: (data) => ipcRenderer.invoke('analytics-save-session', data),
  analyticsLoad: () => ipcRenderer.invoke('analytics-load'),
  analyticsGetInsights: () => ipcRenderer.invoke('analytics-get-insights'),
  analyticsClear: () => ipcRenderer.invoke('analytics-clear'),

  // ─── v1.8.0 Feature Bridges ─────────────────────────────────────────────

  // Prompt Vault
  vaultLoad: () => ipcRenderer.invoke('vault-load'),
  vaultSave: (prompts) => ipcRenderer.invoke('vault-save', prompts),

  // Persona Engine
  personaLoad: () => ipcRenderer.invoke('persona-load'),
  personaSave: (personas) => ipcRenderer.invoke('persona-save', personas),

  // Model Arena
  arenaLoad: () => ipcRenderer.invoke('arena-load'),
  arenaSave: (scores) => ipcRenderer.invoke('arena-save', scores),

  // Workflow Builder
  workflowLoad: () => ipcRenderer.invoke('workflow-load'),
  workflowSave: (workflows) => ipcRenderer.invoke('workflow-save', workflows),

  // Code Workspace
  workspaceTree: (dirPath) => ipcRenderer.invoke('workspace-tree', dirPath),

  // Vision Mode & Screen capture
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  visionChat: (params) => ipcRenderer.invoke('vision-chat', params),

  // RAG Local
  ragEmbed: (params) => ipcRenderer.invoke('rag-embed', params),
  ragIndexLoad: () => ipcRenderer.invoke('rag-index-load'),
  ragIndexSave: (chunks) => ipcRenderer.invoke('rag-index-save', chunks),
  ragSearch: (params) => ipcRenderer.invoke('rag-search', params),
  ragClear: () => ipcRenderer.invoke('rag-clear'),

  // ORION: Computer Control
  orionCapture: () => ipcRenderer.invoke('orion-capture'),
  orionRunAction: (params) => ipcRenderer.invoke('orion-run-action', params),

  // OAuth (Supabase Google PKCE loopback)
  oauthGoogleStart: (params) => ipcRenderer.invoke('oauth-google-start', params),
})
