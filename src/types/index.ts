// ─── Core Types ─────────────────────────────────────────────────────
// Extracted from App.tsx — single source of truth for shared types

export { type AppSettings, type Provider, type Language, type PermissionLevel, type McpServer } from '../Settings'
import type { ReasoningEffort } from '../settingsConfig'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  /** Captured reasoning/thinking blocks (Extended-Thinking display) when the
   *  model emitted any. Shown collapsibly; never sent back to the provider. */
  thinking?: string
  /** v2.130.0 — o turno foi cortado pelo limite de tokens (finish_reason
   *  length/max_tokens). Liga o botão "Continuar gerando" na bolha. */
  truncated?: boolean
  /** v2.130.0 — turno injetado pelo sistema (ex.: o "continue de onde parou"
   *  da continuação) que vai no request ao provedor mas NÃO é renderizado como
   *  bolha no chat. */
  hidden?: boolean
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
  /** Override de esforço de raciocínio por-conversa (v2.50.0). Undefined =
   *  herda o padrão global de Settings. Ver EffortSlider / reasoningEffort. */
  reasoningEffort?: ReasoningEffort
  /** Título da conversa-fonte cujo contexto foi importado para continuar aqui
   *  (v2.58.0). Só para exibir o chip "Continuando de: …". */
  importedFromTitle?: string
  /** Pasta de trabalho APONTADA para esta conversa (v2.84.0, estilo Claude
   *  Code) — execute_command/run_command_background e ops de arquivo rodam aqui
   *  por padrão. Vence o cwd do projeto. Undefined = sem pasta apontada. */
  cwd?: string
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
  /** Default working directory for this project — commands (execute_command)
   *  and file ops in this project's conversations run from here (Projects ciclo
   *  3, v2.12.44). Injected into the system prompt. */
  cwd?: string
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
