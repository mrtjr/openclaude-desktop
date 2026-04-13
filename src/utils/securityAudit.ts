// ─── Security Audit ─────────────────────────────────────────────────
// Automated security check for common misconfigurations.
// Runs from the Command Palette → "Security Check".

import type { AppSettings } from '../types'

export type Severity = 'info' | 'warn' | 'danger'

export interface AuditFinding {
  id: string
  severity: Severity
  title: string
  description: string
  recommendation: string
}

export function runSecurityAudit(settings: AppSettings): AuditFinding[] {
  const findings: AuditFinding[] = []

  // 1. Permission level check
  if (settings.permissionLevel === 'ignore') {
    findings.push({
      id: 'perm-bypass',
      severity: 'danger',
      title: 'Bypass Mode Active',
      description: 'All tool executions are auto-approved without user confirmation. This means the AI can execute commands, write files, and modify your system without asking.',
      recommendation: 'Change permission level to "ask" or "auto_edits" in Settings.',
    })
  }

  // 2. API keys in localStorage
  const keysToCheck = [
    { key: 'openaiApiKey', name: 'OpenAI' },
    { key: 'geminiApiKey', name: 'Gemini' },
    { key: 'anthropicApiKey', name: 'Anthropic' },
    { key: 'openrouterApiKey', name: 'OpenRouter' },
    { key: 'modalApiKey', name: 'Modal' },
  ] as const

  const exposedKeys = keysToCheck.filter(k => (settings as any)[k.key])
  if (exposedKeys.length > 0) {
    findings.push({
      id: 'api-keys-storage',
      severity: 'warn',
      title: `${exposedKeys.length} API Key(s) Stored Locally`,
      description: `API keys for ${exposedKeys.map(k => k.name).join(', ')} are stored in localStorage. Anyone with access to this computer can read them.`,
      recommendation: 'Consider using environment variables or a system keychain for sensitive credentials.',
    })
  }

  // 3. High temperature
  if (settings.temperature > 1.5) {
    findings.push({
      id: 'high-temp',
      severity: 'warn',
      title: 'Very High Temperature',
      description: `Temperature is set to ${settings.temperature}. High values increase randomness and may cause unpredictable tool usage in agent mode.`,
      recommendation: 'Use temperature ≤ 1.0 for agent mode, ≤ 1.5 for creative tasks.',
    })
  }

  // 4. System prompt injection risk
  if (settings.systemPrompt && settings.systemPrompt.length > 2000) {
    findings.push({
      id: 'long-system-prompt',
      severity: 'info',
      title: 'Very Long System Prompt',
      description: `System prompt is ${settings.systemPrompt.length} characters. Very long prompts consume context and may be harder to audit for unintended instructions.`,
      recommendation: 'Keep system prompts concise. Move complex instructions to the Prompt Vault.',
    })
  }

  // 5. No max tokens limit
  if (settings.maxTokens > 16384) {
    findings.push({
      id: 'high-max-tokens',
      severity: 'info',
      title: 'High Max Tokens',
      description: `Max tokens is set to ${settings.maxTokens}. This increases cost per request for cloud providers.`,
      recommendation: 'Set max tokens to 4096 or 8192 for most tasks.',
    })
  }

  // 6. Memory enabled check
  if (settings.memoryEnabled) {
    findings.push({
      id: 'memory-enabled',
      severity: 'info',
      title: 'Persistent Memory Active',
      description: 'The AI stores facts, preferences, and project context between sessions in local files.',
      recommendation: 'Review stored memories periodically via the Agent Memory Panel.',
    })
  }

  // 7. MCP servers configured
  if (settings.mcpServers && settings.mcpServers.length > 0) {
    findings.push({
      id: 'mcp-servers',
      severity: 'warn',
      title: `${settings.mcpServers.length} MCP Server(s) Configured`,
      description: `MCP servers (${settings.mcpServers.map(s => s.name).join(', ')}) run external processes that can access your system. Only use trusted MCP servers.`,
      recommendation: 'Review each MCP server command. Remove any you don\'t recognize.',
    })
  }

  // 8. All clear
  if (findings.length === 0) {
    findings.push({
      id: 'all-clear',
      severity: 'info',
      title: 'No Issues Found',
      description: 'Your current configuration looks secure.',
      recommendation: 'Run this check periodically, especially after changing settings.',
    })
  }

  // Sort: danger first, then warn, then info
  const severityOrder: Record<Severity, number> = { danger: 0, warn: 1, info: 2 }
  return findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}
