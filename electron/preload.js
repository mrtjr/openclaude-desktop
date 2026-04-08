const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // Ollama
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
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (params) => ipcRenderer.invoke('write-file', params),

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

  // Dropped files
  readDroppedFile: (path) => ipcRenderer.invoke('read-dropped-file', path),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-update'),

  // Abort stream
  abortStream: () => ipcRenderer.invoke('abort-stream'),

  // Memory system
  loadMemory: () => ipcRenderer.invoke('load-memory'),
  saveMemory: (data) => ipcRenderer.invoke('save-memory', data),

  // Multi-provider
  providerChat: (params) => ipcRenderer.invoke('provider-chat', params),
})
