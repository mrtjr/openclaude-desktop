// ─── /config key=value (v2.95.0) ────────────────────────────────────
//
// Porta o "/config key=value" do Claude Code: mudar configurações pela barra do
// chat, sem abrir a tela de Configurações. Só expõe um conjunto SEGURO de
// preferências (nada de chaves de API). Coage e valida o valor pelo tipo de
// cada chave. Puro/testável — o App aplica o resultado.

export interface ConfigKeySpec {
  /** Campo real em AppSettings. */
  field: string
  type: 'number' | 'boolean' | 'enum'
  enum?: string[]
  min?: number
  max?: number
}

/** Chaves expostas ao /config (apelido amigável → campo + tipo). NÃO inclui
 *  segredos (apiKeys/hostnames) de propósito. */
export const CONFIG_KEYS: Record<string, ConfigKeySpec> = {
  temperature: { field: 'temperature', type: 'number', min: 0, max: 2 },
  maxtokens: { field: 'maxTokens', type: 'number', min: 1, max: 200000 },
  streaming: { field: 'streamingEnabled', type: 'boolean' },
  thinking: { field: 'showThinking', type: 'boolean' },
  language: { field: 'language', type: 'enum', enum: ['pt', 'en'] },
  permission: { field: 'permissionLevel', type: 'enum', enum: ['ask', 'auto_edits', 'planning', 'ignore'] },
  effort: { field: 'reasoningEffort', type: 'enum', enum: ['default', 'auto', 'off', 'low', 'medium', 'high'] },
  safemode: { field: 'safeMode', type: 'boolean' },
  scout: { field: 'scoutEnabled', type: 'boolean' },
  compress: { field: 'compressToolOutputs', type: 'boolean' },
  notify: { field: 'notifyOnComplete', type: 'boolean' },
  subagents: { field: 'subagentConcurrency', type: 'number', min: 1, max: 8 },
  depth: { field: 'subagentMaxDepth', type: 'number', min: 1, max: 5 },
}

const BOOL_TRUE = new Set(['true', '1', 'on', 'yes', 'sim'])
const BOOL_FALSE = new Set(['false', '0', 'off', 'no', 'nao', 'não'])

/** Coage e valida UM valor pelo tipo da chave. Retorna {value} ou {error}. */
export function coerceConfigValue(spec: ConfigKeySpec, raw: string): { value?: any; error?: string } {
  const v = String(raw ?? '').trim()
  if (spec.type === 'number') {
    const n = Number(v)
    if (!Number.isFinite(n)) return { error: `valor numérico inválido: "${v}"` }
    if (spec.min !== undefined && n < spec.min) return { error: `mínimo ${spec.min}` }
    if (spec.max !== undefined && n > spec.max) return { error: `máximo ${spec.max}` }
    return { value: n }
  }
  if (spec.type === 'boolean') {
    const lo = v.toLowerCase()
    if (BOOL_TRUE.has(lo)) return { value: true }
    if (BOOL_FALSE.has(lo)) return { value: false }
    return { error: `use on/off (recebi "${v}")` }
  }
  // enum
  const lo = v.toLowerCase()
  const hit = (spec.enum || []).find((o) => o.toLowerCase() === lo)
  if (!hit) return { error: `valores: ${(spec.enum || []).join(', ')}` }
  return { value: hit }
}

export interface ConfigApplyResult {
  /** Settings com as mudanças aplicadas (mesma referência se nada mudou). */
  settings: Record<string, any>
  /** Resumo legível por chave aplicada (ex.: "temperature → 0.3"). */
  changes: string[]
  /** Erros por par inválido. */
  errors: string[]
}

/** Aplica um ou mais "key=value" (separados por espaço) sobre `settings`.
 *  Não muta a entrada. Pares inválidos viram erro e são ignorados. */
export function applyConfigCommand(settings: Record<string, any>, arg: string): ConfigApplyResult {
  const text = String(arg ?? '').trim()
  const changes: string[] = []
  const errors: string[] = []
  if (!text) {
    return { settings, changes, errors: [`uso: /config chave=valor — chaves: ${Object.keys(CONFIG_KEYS).join(', ')}`] }
  }
  // Aceita "a=1 b=2" e também "a = 1".
  const pairs = text.match(/([\w-]+)\s*=\s*("[^"]*"|'[^']*'|\S+)/g) || []
  if (!pairs.length) {
    return { settings, changes, errors: [`formato: chave=valor. Chaves: ${Object.keys(CONFIG_KEYS).join(', ')}`] }
  }
  let next = settings
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    const key = pair.slice(0, eq).trim().toLowerCase()
    let val = pair.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    const spec = CONFIG_KEYS[key]
    if (!spec) { errors.push(`chave desconhecida: "${key}"`); continue }
    const c = coerceConfigValue(spec, val)
    if (c.error) { errors.push(`${key}: ${c.error}`); continue }
    if (next === settings) next = { ...settings }
    next[spec.field] = c.value
    changes.push(`${key} → ${c.value}`)
  }
  return { settings: next, changes, errors }
}
