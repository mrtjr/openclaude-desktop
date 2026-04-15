/**
 * Shared types for IPC responses.
 * Keeps the `any` surface small so renderers get autocomplete + regression safety.
 */

export interface ChatChoice {
  message?: {
    content?: string
    role?: string
  }
  finish_reason?: string
  index?: number
}

export interface ChatCompletionResponse {
  choices?: ChatChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  model?: string
  id?: string
}

export interface ParallelChatTask {
  id: string
  messages: Array<{ role: string; content: string }>
  tools?: unknown[]
  /** Optional per-task API key (used by Modal pool dispatch). */
  apiKey?: string
}

export interface ParallelChatResult {
  id: string
  result: ChatCompletionResponse | null
  error: string | null
  apiKey?: string
}

export interface ProviderParallelChatParams {
  tasks: ParallelChatTask[]
  provider: 'modal' | 'ollama'
  model: string
  hostname?: string
  temperature?: number
  max_tokens?: number
}

export interface ParallelChatParams {
  tasks: ParallelChatTask[]
  model: string
  temperature?: number
  max_tokens?: number
}
