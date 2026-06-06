// ─── Core Types ─────────────────────────────────────────────────────
// Extracted from App.tsx — single source of truth for shared types

export { type AppSettings, type Provider, type Language, type PermissionLevel, type McpServer } from '../Settings'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  /** Captured reasoning/thinking blocks (Extended-Thinking display) when the
   *  model emitted any. Shown collapsibly; never sent back to the provider. */
  thinking?: string
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
  /** Workspace this conversation belongs to (Projects, v2.12.42). Undefined =
   *  not in any project ("Todas"). */
  projectId?: string
}

/** A Project groups related conversations into a workspace (Claude-style).
 *  v2.12.42 ships organization (name + color); per-project instructions and
 *  files arrive in later cycles. */
export interface Project {
  id: string
  name: string
  color?: string
  createdAt: Date
  /** Custom instructions injected into the system prompt of every conversation
   *  in this project (Projects ciclo 2, v2.12.43). */
  instructions?: string
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
