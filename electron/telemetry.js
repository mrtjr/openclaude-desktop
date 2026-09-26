const fs = require('fs')
const path = require('path')

// Pasta dos logs: userData do app. O process.cwd() que estava aqui é o
// diretório de onde o app foi ABERTO — no instalado, a pasta de instalação
// (apagada a cada update) ou C:\Windows\System32 (sem permissão: o log falhava
// em silêncio). Fora do Electron (testes/scripts), cai no cwd.
function logDir() {
  try {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') return path.join(app.getPath('userData'), 'logs')
  } catch { /* fora do Electron */ }
  return path.join(process.cwd(), '.claude', 'logs')
}

/**
 * @param {{ agent: string, duration_ms: number, status: 'SUCCESS' | 'FAIL', tokens_used?: number, error?: string }} metric
 */
async function logAgentMetrics(metric) {
  try {
    const dir = logDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const logFile = path.join(dir, 'agent_metrics.jsonl')
    const logEntry = JSON.stringify({ ...metric, timestamp: new Date().toISOString() }) + '\n'

    await fs.promises.appendFile(logFile, logEntry, 'utf-8')
  } catch (e) {
    // Silent fail
  }
}

module.exports = { logAgentMetrics }
