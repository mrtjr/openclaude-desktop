// ─── Feature Registry ───────────────────────────────────────────────
// Central registry of all toggleable features. Controls visibility
// in the Command Palette and Settings.

import { BookMarked, UserCog, Swords, FolderOpen, Camera, Database, GitBranch, Scale, Monitor, Brain, Clock } from 'lucide-react'

export interface FeatureConfig {
  id: string
  name: Record<string, string>  // keyed by language
  description: Record<string, string>
  icon: any  // LucideIcon
  category: 'ai' | 'knowledge' | 'automation'
  shortcut?: string
  defaultEnabled: boolean
}

export const FEATURES: FeatureConfig[] = [
  {
    id: 'persona',
    name: { pt: 'Persona Engine', en: 'Persona Engine' },
    description: { pt: 'Personalidades de IA customizadas', en: 'Custom AI personalities' },
    icon: UserCog,
    category: 'ai',
    shortcut: 'Ctrl+P',
    defaultEnabled: true,
  },
  {
    id: 'arena',
    name: { pt: 'Model Arena', en: 'Model Arena' },
    description: { pt: 'Compare modelos lado a lado', en: 'Compare models side by side' },
    icon: Swords,
    category: 'ai',
    defaultEnabled: true,
  },
  {
    id: 'parliament',
    name: { pt: 'Parlamento', en: 'Parliament' },
    description: { pt: 'Debate multi-agente paralelo', en: 'Parallel multi-agent debate' },
    icon: Scale,
    category: 'ai',
    defaultEnabled: true,
  },
  {
    id: 'orion',
    name: { pt: 'ORION', en: 'ORION' },
    description: { pt: 'Controle visual do computador', en: 'Visual computer control' },
    icon: Monitor,
    category: 'ai',
    defaultEnabled: true,
  },
  {
    id: 'vault',
    name: { pt: 'Prompt Vault', en: 'Prompt Vault' },
    description: { pt: 'Biblioteca de prompts reutilizáveis', en: 'Reusable prompts library' },
    icon: BookMarked,
    category: 'knowledge',
    defaultEnabled: true,
  },
  {
    id: 'rag',
    name: { pt: 'RAG Panel', en: 'RAG Panel' },
    description: { pt: 'Busca semântica em documentos', en: 'Semantic document search' },
    icon: Database,
    category: 'knowledge',
    defaultEnabled: true,
  },
  {
    id: 'workspace',
    name: { pt: 'Código', en: 'Code' },
    description: { pt: 'Editor de código com IA', en: 'AI code editor' },
    icon: FolderOpen,
    category: 'knowledge',
    defaultEnabled: true,
  },
  {
    id: 'workflow',
    name: { pt: 'Workflow Builder', en: 'Workflow Builder' },
    description: { pt: 'Automação visual de tarefas', en: 'Visual task automation' },
    icon: GitBranch,
    category: 'automation',
    defaultEnabled: true,
  },
  {
    id: 'vision',
    name: { pt: 'Visão', en: 'Vision' },
    description: { pt: 'Captura e análise de tela', en: 'Screen capture & analysis' },
    icon: Camera,
    category: 'automation',
    shortcut: 'Ctrl+Shift+V',
    defaultEnabled: true,
  },
  {
    id: 'profiles',
    name: { pt: 'Perfis de Agente', en: 'Agent Profiles' },
    description: { pt: 'Overrides de config por conversa', en: 'Per-conversation config overrides' },
    icon: Brain,
    category: 'ai',
    defaultEnabled: true,
  },
  {
    id: 'scheduler',
    name: { pt: 'Tarefas Agendadas', en: 'Scheduled Tasks' },
    description: { pt: 'Prompts automáticos recorrentes', en: 'Recurring automatic prompts' },
    icon: Clock,
    category: 'automation',
    defaultEnabled: true,
  },
]

/** Get default enabled features map */
export function getDefaultEnabledFeatures(): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const f of FEATURES) {
    map[f.id] = f.defaultEnabled
  }
  return map
}

/** Load enabled features from localStorage */
export function loadEnabledFeatures(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('openclaude-enabled-features')
    if (raw) return { ...getDefaultEnabledFeatures(), ...JSON.parse(raw) }
  } catch (e) { console.warn('[features] load error:', e) }
  return getDefaultEnabledFeatures()
}

/** Save enabled features to localStorage */
export function saveEnabledFeatures(features: Record<string, boolean>) {
  localStorage.setItem('openclaude-enabled-features', JSON.stringify(features))
}

/** Check if a specific feature is enabled */
export function isFeatureEnabled(featureId: string, enabledFeatures: Record<string, boolean>): boolean {
  return enabledFeatures[featureId] !== false
}
