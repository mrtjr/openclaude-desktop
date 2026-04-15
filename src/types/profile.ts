// ─── Agent Profiles ─────────────────────────────────────────────────
// Per-conversation configuration overrides. Unlike Personas (cosmetic
// personalities), Profiles control runtime behavior: provider routing,
// temperature, token limits, system prompt, and permission level.

import type { Provider, PermissionLevel } from '../Settings'

export interface AgentProfile {
  id: string
  name: string
  icon: string           // emoji shorthand
  description: string
  // ── Overrides (undefined = inherit from global settings) ──────
  systemPrompt?: string
  provider?: Provider
  model?: string
  temperature?: number
  maxTokens?: number
  permissionLevel?: PermissionLevel
  // ── Metadata ─────────────────────────────────────────────────
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
}

export const BUILT_IN_PROFILES: AgentProfile[] = [
  {
    id: 'profile-coder',
    name: 'Coder',
    icon: '💻',
    description: 'Focused on code generation and debugging',
    systemPrompt: 'You are a senior software engineer. Be concise, write clean code, explain only when asked. Prefer TypeScript. Always include error handling.',
    temperature: 0.3,
    permissionLevel: 'auto_edits',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'profile-writer',
    name: 'Writer',
    icon: '✍️',
    description: 'Creative writing and content generation',
    systemPrompt: 'You are a skilled writer. Focus on clarity, engagement, and natural flow. Adapt tone to context. Avoid jargon unless the audience expects it.',
    temperature: 0.9,
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'profile-analyst',
    name: 'Analyst',
    icon: '📊',
    description: 'Data analysis, research, and structured thinking',
    systemPrompt: 'You are a data analyst. Think step-by-step, cite sources when possible, use tables and structured formats. Be precise with numbers.',
    temperature: 0.4,
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'profile-safe',
    name: 'Safe Mode',
    icon: '🛡️',
    description: 'Maximum safety — always ask before acting',
    permissionLevel: 'ask',
    temperature: 0.5,
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
]

/** Storage key */
export const PROFILES_STORAGE_KEY = 'openclaude-profiles'
