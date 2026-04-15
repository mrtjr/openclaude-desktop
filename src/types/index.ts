// ─── Core Types ─────────────────────────────────────────────────────
// Extracted from App.tsx — single source of truth for shared types

export { type AppSettings, type Provider, type Language, type PermissionLevel, type McpServer } from '../Settings'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: Date
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

export interface ToolResult {
  toolCallId: string
  name: string
  result: string
  error?: string
}

export interface TaskPlan {
  goal: string
  tasks: { id: string; title: string; status: string; result?: string }[]
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  workingMemory?: Record<string, string>
  taskPlan?: TaskPlan
  contextSummary?: string
  /** Active agent profile for this conversation */
  profileId?: string
}

export interface PendingApproval {
  toolName: string
  args: Record<string, any>
  resolve: (approved: boolean) => void
}

export interface Toast {
  id: number
  message: string
}
