/**
 * ipc-agent-memory.js — v1.9.0
 * Persistent working memory for the agent between sessions.
 * Stored at userData/agent-memory.json
 * Loaded by main.js via: require('./ipc-agent-memory')(ipcMain, app)
 */

module.exports = function registerAgentMemoryHandlers(ipcMain, app) {
  const path = require('path')
  const { atomicWriteJSON, readJSONWithFallback } = require('./atomic-write')

  const AGENT_MEMORY_PATH = path.join(app.getPath('userData'), 'agent-memory.json')

  /** Default shape of agent memory */
  function defaultMemory() {
    return {
      workingMemory: [],   // [{ key: string, value: string, updatedAt: number }]
      episodic:      [],   // [{ summary: string, timestamp: number, conversationId: string }]
      pinned:        [],   // [{ content: string, pinnedAt: number }]
      version:       1,
    }
  }

  function loadAgentMemory() {
    const raw = readJSONWithFallback(AGENT_MEMORY_PATH, null)
    return raw ? { ...defaultMemory(), ...raw } : defaultMemory()
  }

  function saveAgentMemory(data) {
    try {
      atomicWriteJSON(AGENT_MEMORY_PATH, data)
      return { error: null }
    } catch (e) {
      return { error: e.message }
    }
  }

  ipcMain.handle('load-agent-memory', async () => loadAgentMemory())

  ipcMain.handle('save-agent-memory', async (event, data) => saveAgentMemory(data))

  // Append a single episodic memory entry (called after each agent session)
  ipcMain.handle('agent-memory-append-episode', async (event, { summary, conversationId }) => {
    const mem = loadAgentMemory()
    mem.episodic.push({ summary, conversationId, timestamp: Date.now() })
    // Keep max 200 episodes (auto-purge oldest)
    if (mem.episodic.length > 200) mem.episodic = mem.episodic.slice(-200)
    return saveAgentMemory(mem)
  })

  // Upsert a key in workingMemory
  ipcMain.handle('agent-memory-upsert', async (event, { key, value }) => {
    const mem = loadAgentMemory()
    const idx = mem.workingMemory.findIndex(m => m.key === key)
    if (idx >= 0) {
      mem.workingMemory[idx] = { key, value, updatedAt: Date.now() }
    } else {
      mem.workingMemory.push({ key, value, updatedAt: Date.now() })
    }
    return saveAgentMemory(mem)
  })

  // Delete a key from workingMemory
  ipcMain.handle('agent-memory-delete-key', async (event, key) => {
    const mem = loadAgentMemory()
    mem.workingMemory = mem.workingMemory.filter(m => m.key !== key)
    return saveAgentMemory(mem)
  })

  // Clear all agent memory
  ipcMain.handle('agent-memory-clear', async () => {
    return saveAgentMemory(defaultMemory())
  })
}
