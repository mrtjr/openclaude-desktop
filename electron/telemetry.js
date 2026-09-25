const fs = require('fs')
const path = require('path')

/**
 * @param {{ agent: string, duration_ms: number, status: 'SUCCESS' | 'FAIL', tokens_used?: number, error?: string }} metric
 */
async function logAgentMetrics(metric) {
  try {
    const logDir = path.join(process.cwd(), '.claude', 'logs')
    await fs.promises.mkdir(logDir, { recursive: true })
    
    const logFile = path.join(logDir, 'agent_metrics.jsonl')
    const logEntry = JSON.stringify({ ...metric, timestamp: new Date().toISOString() }) + '\n'
    
    await fs.promises.appendFile(logFile, logEntry, 'utf-8')
  } catch (e) {
    // Silent fail
  }
}

module.exports = { logAgentMetrics }
