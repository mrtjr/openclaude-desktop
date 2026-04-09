import { useState, useEffect } from 'react'
import { X, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'

export type Provider = 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal'
export type Language = 'pt' | 'en'
export type PermissionLevel = 'ask' | 'auto_edits' | 'planning' | 'ignore'

export interface AppSettings {
  autoStart: boolean
  temperature: number
  systemPrompt: string
  maxTokens: number
  streamingEnabled: boolean
  language: Language
  provider: Provider
  openaiApiKey: string
  openaiModel: string
  geminiApiKey: string
  geminiModel: string
  anthropicApiKey: string
  anthropicModel: string
  openrouterApiKey: string
  openrouterModel: string
  modalApiKey: string
  modalModel: string
  modalHostname: string
  contextLimit: number
  memoryEnabled: boolean
  analyticsEnabled: boolean
  permissionLevel: PermissionLevel
}

// API key field names that must be stored via safeStorage (never in localStorage)
const CREDENTIAL_KEYS: (keyof AppSettings)[] = [
  'openaiApiKey',
  'geminiApiKey',
  'anthropicApiKey',
  'openrouterApiKey',
  'modalApiKey',
]

// Non-sensitive settings stored in localStorage (no secrets)
type SafeSettings = Omit<AppSettings,
  'openaiApiKey' | 'geminiApiKey' | 'anthropicApiKey' | 'openrouterApiKey' | 'modalApiKey'>

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  temperature: 0.7,
  systemPrompt: `Você é um assistente IA local chamado OpenClaude, rodando via Ollama no computador do usuário.\n\nREGRAS OBRIGATÓRIAS:\n1. SEMPRE responda no mesmo idioma que o usuário usou. Se ele escrever em português, responda em português. Se escrever em inglês, responda em inglês.\n2. Seja direto e objetivo. Não use ferramentas desnecessariamente — só use quando o usuário pedir explicitamente uma ação no sistema.\n3. Quando o usuário disser \"ola\", \"olá\", \"oi\" ou saudações similares, apenas cumprimente de volta e pergunte como pode ajudar. NÃO liste arquivos nem execute comandos.\n4. Use ferramentas (execute_command, read_file, list_directory, etc.) SOMENTE quando o usuário pedir explicitamente.\n5. Respostas curtas para perguntas simples. Respostas detalhadas apenas quando necessário.\n6. Nunca recuse pedidos legítimos do usuário.`,
  maxTokens: 4096,
  streamingEnabled: true,
  language: 'pt',
  provider: 'ollama',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-20250514',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-2.5-pro',
  modalApiKey: '',
  modalModel: 'zai-org/GLM-5.1-FP8',
  modalHostname: 'api.us-west-2.modal.direct',
  contextLimit: 50,
  memoryEnabled: false,
  analyticsEnabled: true,
  // 'ask' is the safest default — always requires explicit user approval
  permissionLevel: 'ask',
}

/**
 * Load non-sensitive settings from localStorage.
 * API keys are loaded separately via safeStorage (electron.credentialsLoad).
 */
export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('openclaude-settings')
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SafeSettings>
      // Strip any API keys that might have been stored in a previous insecure version
      CREDENTIAL_KEYS.forEach((k) => { delete (parsed as Record<string, unknown>)[k as string] })
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

/**
 * Save non-sensitive settings to localStorage.
 * API keys must be persisted via saveCredentials — never via this function.
 */
export function saveSettings(settings: AppSettings) {
  const safe: Partial<AppSettings> = { ...settings }
  // Remove credentials before writing to localStorage
  CREDENTIAL_KEYS.forEach((k) => { delete safe[k] })
  localStorage.setItem('openclaude-settings', JSON.stringify(safe))
}

/**
 * Persist a single API key using Electron safeStorage (OS-level encryption).
 * Falls back silently if safeStorage is unavailable (non-Electron context).
 */
export async function saveCredential(key: string, value: string): Promise<void> {
  try {
    if ((window as any).electron?.credentialsSave) {
      await (window as any).electron.credentialsSave(key, value)
    }
  } catch (e) {
    console.error('[credentials] Failed to save credential:', key, e)
  }
}

/**
 * Load a single API key from Electron safeStorage.
 * Returns empty string if unavailable or not set.
 */
export async function loadCredential(key: string): Promise<string> {
  try {
    if ((window as any).electron?.credentialsLoad) {
      const val = await (window as any).electron.credentialsLoad(key)
      return typeof val === 'string' ? val : ''
    }
  } catch (e) {
    console.error('[credentials] Failed to load credential:', key, e)
  }
  return ''
}

/**
 * Load all API keys from safeStorage and merge into the settings object.
 * Call this once after loadSettings() on app startup.
 */
export async function loadAllCredentials(base: AppSettings): Promise<AppSettings> {
  const [openaiApiKey, geminiApiKey, anthropicApiKey, openrouterApiKey, modalApiKey] =
    await Promise.all([
      loadCredential('openaiApiKey'),
      loadCredential('geminiApiKey'),
      loadCredential('anthropicApiKey'),
      loadCredential('openrouterApiKey'),
      loadCredential('modalApiKey'),
    ])
  return { ...base, openaiApiKey, geminiApiKey, anthropicApiKey, openrouterApiKey, modalApiKey }
}

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  onSave: (settings: AppSettings) => void
}

export default function Settings({ isOpen, onClose, settings, onSave }: SettingsProps) {
  const [local, setLocal] = useState<AppSettings>({ ...settings })
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Tracks which credential fields were changed so we only persist modified keys
  const [changedCredentials, setChangedCredentials] = useState<Set<keyof AppSettings>>(new Set())
  // Controls the "ignore" level confirmation dialog
  const [showIgnoreWarning, setShowIgnoreWarning] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setLocal({ ...settings })
      setFetchedModels([])
      setFetchError(null)
      setChangedCredentials(new Set())
    }
  }, [isOpen, settings])

  useEffect(() => {
    setFetchedModels([])
    setFetchError(null)
  }, [local.provider])

  if (!isOpen) return null

  const handleCredentialChange = (key: keyof AppSettings, value: string) => {
    setLocal((s) => ({ ...s, [key]: value }))
    setChangedCredentials((prev) => new Set(prev).add(key))
  }

  const handlePermissionChange = (level: PermissionLevel) => {
    if (level === 'ignore') {
      setShowIgnoreWarning(true)
      return
    }
    setLocal((s) => ({ ...s, permissionLevel: level }))
  }

  const confirmIgnoreLevel = () => {
    setLocal((s) => ({ ...s, permissionLevel: 'ignore' }))
    setShowIgnoreWarning(false)
  }

  const handleSave = async () => {
    // Persist non-sensitive settings to localStorage
    saveSettings(local)

    // Persist changed API keys via safeStorage (OS-encrypted)
    const credentialSavePromises: Promise<void>[] = []
    if (changedCredentials.has('openaiApiKey'))
      credentialSavePromises.push(saveCredential('openaiApiKey', local.openaiApiKey))
    if (changedCredentials.has('geminiApiKey'))
      credentialSavePromises.push(saveCredential('geminiApiKey', local.geminiApiKey))
    if (changedCredentials.has('anthropicApiKey'))
      credentialSavePromises.push(saveCredential('anthropicApiKey', local.anthropicApiKey))
    if (changedCredentials.has('openrouterApiKey'))
      credentialSavePromises.push(saveCredential('openrouterApiKey', local.openrouterApiKey))
    if (changedCredentials.has('modalApiKey'))
      credentialSavePromises.push(saveCredential('modalApiKey', local.modalApiKey))

    await Promise.all(credentialSavePromises)

    try {
      await window.electron.setAutoStart(local.autoStart)
    } catch {}
    onSave(local)
    onClose()
  }

  const fetchModels = async () => {
    const apiKey =
      local.provider === 'openai' ? local.openaiApiKey :
      local.provider === 'gemini' ? local.geminiApiKey :
      local.provider === 'anthropic' ? local.anthropicApiKey :
      local.provider === 'modal' ? local.modalApiKey :
      local.provider === 'openrouter' ? local.openrouterApiKey : ''

    if (!apiKey) {
      setFetchError(local.language === 'pt' ? 'Insira a API Key primeiro' : 'Enter API Key first')
      return
    }

    setIsFetching(true)
    setFetchError(null)
    try {
      const result = await (window as any).electron.listProviderModels({
        provider: local.provider,
        apiKey,
        modalHostname: local.modalHostname,
      })
      if (result.error) {
        setFetchError(result.error)
      } else if (result.models) {
        setFetchedModels(result.models)
        if (result.models.length === 0) {
          setFetchError(
            local.language === 'pt' ? 'Nenhum modelo encontrado' : 'No models found'
          )
        }
      }
    } catch (e: any) {
      setFetchError(e.message)
    } finally {
      setIsFetching(false)
    }
  }

  return (
    <div
      className="settings-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Configurações</h2>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="settings-body">
          {/* Language selector */}
          <div className="settings-group">
            <label className="settings-label">
              <span>{local.language === 'pt' ? 'Idioma das respostas' : 'Response language'}</span>
            </label>
            <select
              className="settings-input"
              value={local.language}
              onChange={(e) => setLocal((s) => ({ ...s, language: e.target.value as Language }))}
            >
              <option value="pt">Portugues (Brasil)</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Provider selector */}
          <div className="settings-group">
            <label className="settings-label">
              <span>{local.language === 'pt' ? 'Provedor de IA' : 'AI Provider'}</span>
            </label>
            <select
              className="settings-input"
              value={local.provider}
              onChange={(e) => setLocal((s) => ({ ...s, provider: e.target.value as Provider }))}
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="openrouter">OpenRouter</option>
              <option value="modal">Modal (Research)</option>
            </select>
          </div>

          {/* OpenAI settings */}
          {local.provider === 'openai' && (
            <>
              <div className="settings-group">
                <label className="settings-label"><span>API Key OpenAI</span></label>
                <input
                  type="password"
                  className="settings-input"
                  value={local.openaiApiKey}
                  onChange={(e) => handleCredentialChange('openaiApiKey', e.target.value)}
                  placeholder="sk-..."
                />
                <button
                  className="settings-fetch-btn"
                  onClick={fetchModels}
                  disabled={isFetching || !local.openaiApiKey}
                >
                  {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                </button>
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo OpenAI</span></label>
                <input
                  type="text"
                  className="settings-input"
                  list="openai-models"
                  value={local.openaiModel}
                  onChange={(e) => setLocal((s) => ({ ...s, openaiModel: e.target.value }))}
                  placeholder="gpt-4o"
                />
                <datalist id="openai-models">
                  {fetchedModels.map((m) => <option key={m} value={m} />)}
                  {!fetchedModels.length && (
                    <>
                      <option value="gpt-4o" />
                      <option value="gpt-4o-mini" />
                      <option value="gpt-3.5-turbo" />
                    </>
                  )}
                </datalist>
              </div>
              {fetchError && (
                <div className="settings-error" style={{ color: '#ff4d4d', fontSize: '0.8rem', marginTop: '5px' }}>
                  {fetchError}
                </div>
              )}
            </>
          )}

          {/* Gemini settings */}
          {local.provider === 'gemini' && (
            <>
              <div className="settings-group">
                <label className="settings-label"><span>API Key Gemini</span></label>
                <input
                  type="password"
                  className="settings-input"
                  value={local.geminiApiKey}
                  onChange={(e) => handleCredentialChange('geminiApiKey', e.target.value)}
                  placeholder="AIza..."
                />
                <button
                  className="settings-fetch-btn"
                  onClick={fetchModels}
                  disabled={isFetching || !local.geminiApiKey}
                >
                  {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                </button>
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo Gemini</span></label>
                <input
                  type="text"
                  className="settings-input"
                  list="gemini-models"
                  value={local.geminiModel}
                  onChange={(e) => setLocal((s) => ({ ...s, geminiModel: e.target.value }))}
                  placeholder="gemini-2.0-flash"
                />
                <datalist id="gemini-models">
                  {fetchedModels.map((m) => <option key={m} value={m} />)}
                  {!fetchedModels.length && (
                    <>
                      <option value="gemini-2.0-flash" />
                      <option value="gemini-1.5-pro" />
                      <option value="gemini-1.5-flash" />
                    </>
                  )}
                </datalist>
              </div>
              {fetchError && (
                <div className="settings-error" style={{ color: '#ff4d4d', fontSize: '0.8rem', marginTop: '5px' }}>
                  {fetchError}
                </div>
              )}
            </>
          )}

          {/* Anthropic settings */}
          {local.provider === 'anthropic' && (
            <>
              <div className="settings-group">
                <label className="settings-label"><span>API Key Anthropic</span></label>
                <input
                  type="password"
                  className="settings-input"
                  value={local.anthropicApiKey}
                  onChange={(e) => handleCredentialChange('anthropicApiKey', e.target.value)}
                  placeholder="sk-ant-..."
                />
                <button
                  className="settings-fetch-btn"
                  onClick={fetchModels}
                  disabled={isFetching || !local.anthropicApiKey}
                >
                  {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                </button>
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo Anthropic</span></label>
                <input
                  type="text"
                  className="settings-input"
                  list="anthropic-models"
                  value={local.anthropicModel}
                  onChange={(e) => setLocal((s) => ({ ...s, anthropicModel: e.target.value }))}
                  placeholder="claude-sonnet-4-20250514"
                />
                <datalist id="anthropic-models">
                  {fetchedModels.map((m) => <option key={m} value={m} />)}
                  {!fetchedModels.length && (
                    <>
                      <option value="claude-3-5-sonnet-20241022" />
                      <option value="claude-3-opus-20240229" />
                      <option value="claude-3-haiku-20240307" />
                    </>
                  )}
                </datalist>
              </div>
              {fetchError && (
                <div className="settings-error" style={{ color: '#ff4d4d', fontSize: '0.8rem', marginTop: '5px' }}>
                  {fetchError}
                </div>
              )}
            </>
          )}

          {/* OpenRouter settings */}
          {local.provider === 'openrouter' && (
            <>
              <div className="settings-group">
                <label className="settings-label"><span>API Key OpenRouter</span></label>
                <input
                  type="password"
                  className="settings-input"
                  value={local.openrouterApiKey || ''}
                  onChange={(e) => handleCredentialChange('openrouterApiKey', e.target.value)}
                  placeholder="sk-or-v1-..."
                />
                <button
                  className="settings-fetch-btn"
                  onClick={fetchModels}
                  disabled={isFetching || !local.openrouterApiKey}
                >
                  {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                </button>
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo OpenRouter</span></label>
                <input
                  type="text"
                  className="settings-input"
                  list="openrouter-models"
                  value={local.openrouterModel || ''}
                  onChange={(e) => setLocal((s) => ({ ...s, openrouterModel: e.target.value }))}
                  placeholder="google/gemini-2.5-pro"
                />
                <datalist id="openrouter-models">
                  {fetchedModels.map((m) => <option key={m} value={m} />)}
                  {!fetchedModels.length && (
                    <>
                      <option value="google/gemini-2.0-flash-001" />
                      <option value="openai/gpt-4o" />
                      <option value="anthropic/claude-3.5-sonnet" />
                    </>
                  )}
                </datalist>
              </div>
              {fetchError && (
                <div className="settings-error" style={{ color: '#ff4d4d', fontSize: '0.8rem', marginTop: '5px' }}>
                  {fetchError}
                </div>
              )}
            </>
          )}

          {/* Modal settings */}
          {local.provider === 'modal' && (
            <>
              <div className="settings-group">
                <label className="settings-label"><span>API Key Modal</span></label>
                <input
                  type="password"
                  className="settings-input"
                  value={local.modalApiKey || ''}
                  onChange={(e) => handleCredentialChange('modalApiKey', e.target.value)}
                  placeholder="modalresearch_..."
                />
                <button
                  className="settings-fetch-btn"
                  onClick={fetchModels}
                  disabled={isFetching || !local.modalApiKey}
                >
                  {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                </button>
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo Modal</span></label>
                <input
                  type="text"
                  className="settings-input"
                  list="modal-models"
                  value={local.modalModel || ''}
                  onChange={(e) => setLocal((s) => ({ ...s, modalModel: e.target.value }))}
                  placeholder="zai-org/GLM-5.1-FP8"
                />
                <datalist id="modal-models">
                  {fetchedModels.map((m) => <option key={m} value={m} />)}
                  {!fetchedModels.length && (
                    <>
                      <option value="zai-org/GLM-5.1-FP8" />
                    </>
                  )}
                </datalist>
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Hostname Modal</span></label>
                <input
                  type="text"
                  className="settings-input"
                  value={local.modalHostname || ''}
                  onChange={(e) => setLocal((s) => ({ ...s, modalHostname: e.target.value }))}
                  placeholder="api.us-west-2.modal.direct"
                />
              </div>
              {fetchError && (
                <div className="settings-error" style={{ color: '#ff4d4d', fontSize: '0.8rem', marginTop: '5px' }}>
                  {fetchError}
                </div>
              )}
            </>
          )}

          {/* Auto-start */}
          <div className="settings-group">
            <label className="settings-label">
              <span>Iniciar com o Windows</span>
              <div
                className={`toggle ${local.autoStart ? 'on' : ''}`}
                onClick={() => setLocal((s) => ({ ...s, autoStart: !s.autoStart }))}
              >
                <div className="toggle-knob" />
              </div>
            </label>
          </div>

          {/* Streaming */}
          <div className="settings-group">
            <label className="settings-label">
              <span>Streaming de respostas</span>
              <div
                className={`toggle ${local.streamingEnabled ? 'on' : ''}`}
                onClick={() => setLocal((s) => ({ ...s, streamingEnabled: !s.streamingEnabled }))}
              >
                <div className="toggle-knob" />
              </div>
            </label>
          </div>

          {/* Memory */}
          <div className="settings-group">
            <label className="settings-label">
              <span>Memória persistente</span>
              <div
                className={`toggle ${local.memoryEnabled ? 'on' : ''}`}
                onClick={() => setLocal((s) => ({ ...s, memoryEnabled: !s.memoryEnabled }))}
              >
                <div className="toggle-knob" />
              </div>
            </label>
          </div>

          {/* Analytics */}
          <div className="settings-group">
            <label className="settings-label">
              <span>
                {local.language === 'pt'
                  ? 'Analytics (coleta local)'
                  : 'Analytics (local collection)'}
              </span>
              <div
                className={`toggle ${local.analyticsEnabled ? 'on' : ''}`}
                onClick={() => setLocal((s) => ({ ...s, analyticsEnabled: !s.analyticsEnabled }))}
              >
                <div className="toggle-knob" />
              </div>
            </label>
          </div>

          {/* Temperature */}
          <div className="settings-group">
            <label className="settings-label">
              <span>Temperatura</span>
              <span className="settings-value">{local.temperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={local.temperature}
              onChange={(e) => setLocal((s) => ({ ...s, temperature: parseFloat(e.target.value) }))}
              className="settings-slider"
            />
          </div>

          {/* Permission Level */}
          <div className="settings-group">
            <label className="settings-label">
              <span>{local.language === 'pt' ? 'Nível de Permissão' : 'Permission Level'}</span>
            </label>
            <select
              className="settings-select"
              value={local.permissionLevel || 'ask'}
              onChange={(e) => handlePermissionChange(e.target.value as PermissionLevel)}
            >
              <option value="ask">
                {local.language === 'pt' ? 'Solicitar permissões' : 'Always ask'}
              </option>
              <option value="auto_edits">
                {local.language === 'pt' ? 'Aceitar edições automaticamente' : 'Auto-accept edits'}
              </option>
              <option value="planning">
                {local.language === 'pt' ? 'Modo de planejamento' : 'Planning mode'}
              </option>
              <option value="ignore">
                {local.language === 'pt' ? '⚠️ Ignorar permissões' : '⚠️ Ignore all'}
              </option>
            </select>

            {/* Warning banner shown when ignore or auto_edits is active */}
            {local.permissionLevel === 'ignore' && (
              <div
                className="settings-warning-banner"
                style={{
                  marginTop: '8px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: 'rgba(255, 80, 80, 0.12)',
                  border: '1px solid rgba(255, 80, 80, 0.35)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  fontSize: '0.78rem',
                  color: '#ff6b6b',
                  lineHeight: 1.5,
                }}
              >
                <AlertTriangle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>
                  {local.language === 'pt'
                    ? 'Modo IGNORAR PERMISSÕES ativo. Todas as ferramentas perigosas (exec, escrita de arquivos, git) serão executadas SEM confirmação. Use apenas em ambiente isolado e controlado.'
                    : 'IGNORE PERMISSIONS mode is active. All dangerous tools (exec, file write, git) will run WITHOUT confirmation. Use only in an isolated, controlled environment.'}
                </span>
              </div>
            )}
            {local.permissionLevel === 'auto_edits' && (
              <div
                className="settings-warning-banner"
                style={{
                  marginTop: '8px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: 'rgba(255, 160, 0, 0.10)',
                  border: '1px solid rgba(255, 160, 0, 0.30)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  fontSize: '0.78rem',
                  color: '#ffa500',
                  lineHeight: 1.5,
                }}
              >
                <AlertTriangle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>
                  {local.language === 'pt'
                    ? 'Modo AUTO-EDIÇÕES ativo. Operações de escrita de arquivos e comandos git serão executadas automaticamente sem confirmação.'
                    : 'AUTO-EDITS mode is active. File write and git operations will run automatically without confirmation.'}
                </span>
              </div>
            )}
          </div>

          {/* Context limit */}
          <div className="settings-group">
            <label className="settings-label">
              <span>Limite de contexto (mensagens)</span>
              <span className="settings-value">{local.contextLimit}</span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={local.contextLimit}
              onChange={(e) =>
                setLocal((s) => ({ ...s, contextLimit: parseInt(e.target.value) }))
              }
              className="settings-slider"
            />
          </div>

          {/* Max tokens */}
          <div className="settings-group">
            <label className="settings-label">
              <span>Max tokens</span>
            </label>
            <input
              type="number"
              min={256}
              max={32768}
              step={256}
              value={local.maxTokens}
              onChange={(e) =>
                setLocal((s) => ({ ...s, maxTokens: parseInt(e.target.value) || 4096 }))
              }
              className="settings-input"
            />
          </div>

          {/* System prompt */}
          <div className="settings-group">
            <label className="settings-label">
              <span>System Prompt</span>
            </label>
            <textarea
              value={local.systemPrompt}
              onChange={(e) => setLocal((s) => ({ ...s, systemPrompt: e.target.value }))}
              placeholder="Instrucoes do sistema (opcional)..."
              className="settings-textarea"
              rows={4}
            />
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-cancel-btn" onClick={onClose}>Cancelar</button>
          <button className="settings-save-btn" onClick={handleSave}>Salvar</button>
        </div>
      </div>

      {/* Confirmation dialog for "ignore" permission level */}
      {showIgnoreWarning && (
        <div
          className="settings-overlay"
          style={{ zIndex: 1100 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowIgnoreWarning(false) }}
        >
          <div
            className="settings-modal"
            style={{ maxWidth: '420px', padding: '24px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <AlertTriangle size={22} color="#ff6b6b" />
              <h3 style={{ color: '#ff6b6b', margin: 0 }}>
                {local.language === 'pt' ? 'Atenção: Risco de Segurança' : 'Warning: Security Risk'}
              </h3>
            </div>
            <p style={{ fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '20px' }}>
              {local.language === 'pt'
                ? 'O modo "Ignorar Permissões" desativa todas as confirmações de segurança. O agente poderá executar comandos, modificar arquivos e interagir com o git sem nenhuma aprovação sua. Use apenas se souber exatamente o que está fazendo e em um ambiente controlado.'
                : 'The "Ignore Permissions" mode disables all security confirmations. The agent will be able to execute commands, modify files, and interact with git without any approval from you. Use only if you know exactly what you are doing and in a controlled environment.'}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                className="settings-cancel-btn"
                onClick={() => setShowIgnoreWarning(false)}
              >
                {local.language === 'pt' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                style={{
                  background: '#ff4d4d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                onClick={confirmIgnoreLevel}
              >
                {local.language === 'pt' ? 'Entendi, ativar mesmo assim' : 'I understand, activate anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
