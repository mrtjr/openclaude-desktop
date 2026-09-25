import fs from 'fs'
import path from 'path'

export interface AgentMetric {
  agent: string
  duration_ms: number
  status: 'SUCCESS' | 'FAIL'
  tokens_used?: number
  error?: string
}

export async function logAgentMetrics(metric: AgentMetric): Promise<void> {
  try {
    // We assume the root directory is available or we use a relative path from cwd
    // In a real Electron app, app.getPath('userData') would be better, but we follow the exact spec:
    const logDir = path.join(process.cwd(), '.claude', 'logs')
    await fs.promises.mkdir(logDir, { recursive: true })
    
    const logFile = path.join(logDir, 'agent_metrics.jsonl')
    const logEntry = JSON.stringify({ ...metric, timestamp: new Date().toISOString() }) + '\n'
    
    await fs.promises.appendFile(logFile, logEntry, 'utf-8')
  } catch (e) {
    // Silent fail
  }
}
