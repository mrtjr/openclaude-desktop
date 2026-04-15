import { useState, useEffect } from 'react'
import { X, RefreshCw, Loader2, Plus, Trash2 } from 'lucide-react'

export type Provider = 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal'
export type Language = 'pt' | 'en'
export type PermissionLevel = 'ask' | 'auto_edits' | 'planning' | 'ignore'

export interface McpServer {
  name: string
  command: string
}

export interface ModalKey {
  id: string
  key: string
  label?: string
  enabled: boolean
}

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
  modalApiKeys: ModalKey[]
  modalPoolFallbackOllama: boolean
  modalModel: string
  modalHostname: string
  contextLimit: number
  memoryEnabled: boolean
  analyticsEnabled: boolean
  permissionLevel: PermissionLevel
  mcpServers: McpServer[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  temperature: 0.7,
  systemPrompt: `Você é um assistente IA chamado OpenClaude.\n\nREGRAS OBRIGATÓRIAS:\n1. SEMPRE responda no mesmo idioma que o usuário usou. Se ele escrever em português, responda em português. Se escrever em inglês, responda em inglês.\n2. Seja direto e objetivo. Não use ferramentas desnecessariamente — só use quando o usuário pedir explicitamente uma ação no sistema.\n3. Quando o usuário disser \"ola\", \"olá\", \"oi\" ou saudações similares, apenas cumprimente de volta e pergunte como pode ajudar. NÃO liste arquivos nem execute comandos.\n4. Use ferramentas (execute_command, read_file, list_directory, etc.) SOMENTE quando o usuário pedir explicitamente.\n5. Respostas curtas para perguntas simples. Respostas detalhadas apenas quando necessário.\n6. Nunca recuse pedidos legítimos do usuário.`,
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
  modalApiKeys: [],
  modalPoolFallbackOllama: false,
  modalModel: 'zai-org/GLM-5.1-FP8',
  modalHostname: 'api.us-west-2.modal.direct',
  contextLimit: 50,
  memoryEnabled: false,
  analyticsEnabled: true,
  permissionLevel: 'ask',
  mcpServers: [],
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('openclaude-settings')
    if (stored) {
      const merged: AppSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      // Migration: populate modalApiKeys array from legacy single modalApiKey
      if (merged.modalApiKey && (!merged.modalApiKeys || merged.modalApiKeys.length === 0)) {
        merged.modalApiKeys = [{
          id: 'migrated-' + Date.now(),
          key: merged.modalApiKey,
          label: 'Principal',
          enabled: true,
        }]
      }
      return merged
    }
  } catch (e) { console.warn('[settings] load error:', e) }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem('openclaude-settings', JSON.stringify(settings))
}

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  onSave: (settings: AppSettings) => void
}

type SettingsTab = 'general' | 'provider' | 'mcp'

export default function Settings({ isOpen, onClose, settings, onSave }: SettingsProps) {
  const [local, setLocal] = useState<AppSettings>({ ...settings })
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({})
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [newMcpName, setNewMcpName] = useState('')
  const [newMcpCommand, setNewMcpCommand] = useState('')

  useEffect(() => {
    if (isOpen) {
      setLocal({ ...settings })
      setFetchedModels({})
      setFetchError(null)
    }
  }, [isOpen, settings])

  useEffect(() => {
    setFetchError(null)
  }, [local.provider])

  if (!isOpen) return null

  const handleSave = async () => {
    saveSettings(local)
    try {
      await window.electron.setAutoStart(local.autoStart)
      // Persist MCP servers via IPC if available
      if (window.electron.saveMcpServers) {
        await window.electron.saveMcpServers(local.mcpServers)
      }
    } catch (e) { console.warn('[settings] save error:', e) }
    onSave(local)
    onClose()
  }

  const fetchModels = async () => {
    const apiKey = local.provider === 'openai' ? local.openaiApiKey :
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
        modalHostname: local.modalHostname
      })
      if (result.error) {
        setFetchError(result.error)
      } else if (result.models) {
        setFetchedModels(prev => ({ ...prev, [local.provider]: result.models }))
        if (result.models.length === 0) {
          setFetchError(local.language === 'pt' ? 'Nenhum modelo encontrado' : 'No models found')
        }
      }
    } catch (e: any) {
      setFetchError(e.message)
    } finally {
      setIsFetching(false)
    }
  }

  const addMcpServer = () => {
    if (!newMcpName.trim() || !newMcpCommand.trim()) return
    setLocal(s => ({
      ...s,
      mcpServers: [...(s.mcpServers || []), { name: newMcpName.trim(), command: newMcpCommand.trim() }]
    }))
    setNewMcpName('')
    setNewMcpCommand('')
  }

  const removeMcpServer = (idx: number) => {
    setLocal(s => ({
      ...s,
      mcpServers: (s.mcpServers || []).filter((_, i) => i !== idx)
    }))
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: local.language === 'pt' ? 'Geral' : 'General' },
    { id: 'provider', label: local.language === 'pt' ? 'Provedor' : 'Provider' },
    { id: 'mcp', label: 'MCP' },
  ]

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Configurações</h2>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tab bar */}
        <div className="settings-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`settings-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-body">

          {/* ── GENERAL TAB ── */}
          {activeTab === 'general' && (
            <>
              {/* Language selector */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'pt' ? 'Idioma das respostas' : 'Response language'}</span>
                </label>
                <select
                  className="settings-input"
                  value={local.language}
                  onChange={(e) => setLocal(s => ({ ...s, language: e.target.value as Language }))}
                >
                  <option value="pt">Portugues (Brasil)</option>
                  <option value="en">English</option>
                </select>
              </div>

              {/* Auto-start */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>Iniciar com o Windows</span>
                  <div className={`toggle ${local.autoStart ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, autoStart: !s.autoStart }))}>
                    <div className="toggle-knob" />
                  </div>
                </label>
              </div>

              {/* Streaming */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>Streaming de respostas</span>
                  <div className={`toggle ${local.streamingEnabled ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, streamingEnabled: !s.streamingEnabled }))}>
                    <div className="toggle-knob" />
                  </div>
                </label>
              </div>

              {/* Memory */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>Memória persistente</span>
                  <div className={`toggle ${local.memoryEnabled ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, memoryEnabled: !s.memoryEnabled }))}>
                    <div className="toggle-knob" />
                  </div>
                </label>
              </div>

              {/* Analytics */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'pt' ? 'Analytics (coleta local)' : 'Analytics (local collection)'}</span>
                  <div className={`toggle ${local.analyticsEnabled ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, analyticsEnabled: !s.analyticsEnabled }))}>
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
                  onChange={(e) => setLocal(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                  className="settings-slider"
                />
              </div>

              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'pt' ? 'Nível de Permissão' : 'Permission Level'}</span>
                </label>
                <select
                  className="settings-select"
                  value={local.permissionLevel || 'ask'}
                  onChange={(e) => setLocal(s => ({ ...s, permissionLevel: e.target.value as PermissionLevel }))}
                >
                  <option value="ask">{local.language === 'pt' ? 'Solicitar permissões' : 'Always ask'}</option>
                  <option value="auto_edits">{local.language === 'pt' ? 'Aceitar edições automaticamente' : 'Auto-accept edits'}</option>
                  <option value="planning">{local.language === 'pt' ? 'Modo de planejamento' : 'Planning mode'}</option>
                  <option value="ignore">{local.language === 'pt' ? 'Ignorar permissões' : 'Ignore all'}</option>
                </select>
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
                  onChange={(e) => setLocal(s => ({ ...s, contextLimit: parseInt(e.target.value) }))}
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
                  onChange={(e) => setLocal(s => ({ ...s, maxTokens: parseInt(e.target.value) || 4096 }))}
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
                  onChange={(e) => setLocal(s => ({ ...s, systemPrompt: e.target.value }))}
                  placeholder="Instrucoes do sistema (opcional)..."
                  className="settings-textarea"
                  rows={4}
                />
              </div>
            </>
          )}

          {/* ── PROVIDER TAB ── */}
          {activeTab === 'provider' && (
            <>
              {/* Provider selector */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'pt' ? 'Provedor de IA' : 'AI Provider'}</span>
                </label>
                <select
                  className="settings-input"
                  value={local.provider}
                  onChange={(e) => setLocal(s => ({ ...s, provider: e.target.value as Provider }))}
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
                      onChange={(e) => setLocal(s => ({ ...s, openaiApiKey: e.target.value }))}
                      placeholder="sk-..."
                    />
                    <button className="settings-fetch-btn" onClick={fetchModels} disabled={isFetching || !local.openaiApiKey}>
                      {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                    </button>
                  </div>
                  <div className="settings-group">
                    <label className="settings-label"><span>Modelo OpenAI</span></label>
                    <input type="text" className="settings-input" list="openai-models" value={local.openaiModel}
                      onChange={(e) => setLocal(s => ({ ...s, openaiModel: e.target.value }))} placeholder="gpt-4o" />
                    <datalist id="openai-models">
                      {(fetchedModels['openai'] || []).map(m => <option key={m} value={m} />)}
                      {!(fetchedModels['openai'] || []).length && (<><option value="gpt-4o" /><option value="gpt-4o-mini" /><option value="gpt-3.5-turbo" /></>)}
                    </datalist>
                  </div>
                  {fetchError && <div className="settings-fetch-error">{fetchError}</div>}
                </>
              )}

              {/* Gemini settings */}
              {local.provider === 'gemini' && (
                <>
                  <div className="settings-group">
                    <label className="settings-label"><span>API Key Gemini</span></label>
                    <input type="password" className="settings-input" value={local.geminiApiKey}
                      onChange={(e) => setLocal(s => ({ ...s, geminiApiKey: e.target.value }))} placeholder="AIza..." />
                    <button className="settings-fetch-btn" onClick={fetchModels} disabled={isFetching || !local.geminiApiKey}>
                      {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                    </button>
                  </div>
                  <div className="settings-group">
                    <label className="settings-label"><span>Modelo Gemini</span></label>
                    <input type="text" className="settings-input" list="gemini-models" value={local.geminiModel}
                      onChange={(e) => setLocal(s => ({ ...s, geminiModel: e.target.value }))} placeholder="gemini-2.0-flash" />
                    <datalist id="gemini-models">
                      {(fetchedModels['gemini'] || []).map(m => <option key={m} value={m} />)}
                      {!(fetchedModels['gemini'] || []).length && (<><option value="gemini-2.0-flash" /><option value="gemini-1.5-pro" /><option value="gemini-1.5-flash" /></>)}
                    </datalist>
                  </div>
                  {fetchError && <div className="settings-fetch-error">{fetchError}</div>}
                </>
              )}

              {/* Anthropic settings */}
              {local.provider === 'anthropic' && (
                <>
                  <div className="settings-group">
                    <label className="settings-label"><span>API Key Anthropic</span></label>
                    <input type="password" className="settings-input" value={local.anthropicApiKey}
                      onChange={(e) => setLocal(s => ({ ...s, anthropicApiKey: e.target.value }))} placeholder="sk-ant-..." />
                    <button className="settings-fetch-btn" onClick={fetchModels} disabled={isFetching || !local.anthropicApiKey}>
                      {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                    </button>
                  </div>
                  <div className="settings-group">
                    <label className="settings-label"><span>Modelo Anthropic</span></label>
                    <input type="text" className="settings-input" list="anthropic-models" value={local.anthropicModel}
                      onChange={(e) => setLocal(s => ({ ...s, anthropicModel: e.target.value }))} placeholder="claude-sonnet-4-20250514" />
                    <datalist id="anthropic-models">
                      {(fetchedModels['anthropic'] || []).map(m => <option key={m} value={m} />)}
                      {!(fetchedModels['anthropic'] || []).length && (<><option value="claude-3-5-sonnet-20241022" /><option value="claude-3-opus-20240229" /><option value="claude-3-haiku-20240307" /></>)}
                    </datalist>
                  </div>
                  {fetchError && <div className="settings-fetch-error">{fetchError}</div>}
                </>
              )}

              {/* OpenRouter settings */}
              {local.provider === 'openrouter' && (
                <>
                  <div className="settings-group">
                    <label className="settings-label"><span>API Key OpenRouter</span></label>
                    <input type="password" className="settings-input" value={local.openrouterApiKey || ''}
                      onChange={(e) => setLocal(s => ({ ...s, openrouterApiKey: e.target.value }))} placeholder="sk-or-v1-..." />
                    <button className="settings-fetch-btn" onClick={fetchModels} disabled={isFetching || !local.openrouterApiKey}>
                      {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                    </button>
                  </div>
                  <div className="settings-group">
                    <label className="settings-label"><span>Modelo OpenRouter</span></label>
                    <input type="text" className="settings-input" list="openrouter-models" value={local.openrouterModel || ''}
                      onChange={(e) => setLocal(s => ({ ...s, openrouterModel: e.target.value }))} placeholder="google/gemini-2.5-pro" />
                    <datalist id="openrouter-models">
                      {(fetchedModels['openrouter'] || []).map(m => <option key={m} value={m} />)}
                      {!(fetchedModels['openrouter'] || []).length && (<><option value="google/gemini-2.0-flash-001" /><option value="openai/gpt-4o" /><option value="anthropic/claude-3.5-sonnet" /></>)}
                    </datalist>
                  </div>
                  {fetchError && <div className="settings-fetch-error">{fetchError}</div>}
                </>
              )}

              {/* Modal settings */}
              {local.provider === 'modal' && (
                <>
                  <div className="settings-group">
                    <label className="settings-label"><span>API Key Modal (principal)</span></label>
                    <input type="password" className="settings-input" value={local.modalApiKey || ''}
                      onChange={(e) => {
                        const v = e.target.value
                        setLocal(s => {
                          // Sync first key in pool with principal key
                          const keys = [...(s.modalApiKeys || [])]
                          if (keys.length === 0) {
                            keys.push({ id: 'primary-' + Date.now(), key: v, label: 'Principal', enabled: true })
                          } else {
                            keys[0] = { ...keys[0], key: v }
                          }
                          return { ...s, modalApiKey: v, modalApiKeys: keys }
                        })
                      }}
                      placeholder="modalresearch_..." />
                    <button className="settings-fetch-btn" onClick={fetchModels} disabled={isFetching || !local.modalApiKey}>
                      {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      <span>{local.language === 'pt' ? 'Detectar Modelos' : 'Detect Models'}</span>
                    </button>
                  </div>

                  {/* Pool of additional keys for delegate_subtasks */}
                  <div className="settings-group">
                    <label className="settings-label">
                      <span>{local.language === 'pt' ? 'Pool de API Keys (subagentes paralelos)' : 'API Key Pool (parallel subagents)'}</span>
                    </label>
                    <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #888)', marginBottom: '8px' }}>
                      {local.language === 'pt'
                        ? 'Cada key permite 1 subagente em paralelo. A key principal acima é automaticamente a primeira do pool.'
                        : 'Each key enables 1 parallel subagent. The principal key above is automatically the first in the pool.'}
                    </p>
                    {(local.modalApiKeys || []).map((mk, idx) => (
                      <div key={mk.id} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="settings-input"
                          value={mk.label || ''}
                          placeholder={idx === 0 ? 'Principal' : `Key ${idx + 1}`}
                          onChange={(e) => {
                            const v = e.target.value
                            setLocal(s => ({ ...s, modalApiKeys: s.modalApiKeys.map(k => k.id === mk.id ? { ...k, label: v } : k) }))
                          }}
                          style={{ flex: '0 0 120px' }}
                          disabled={idx === 0}
                        />
                        <input
                          type="password"
                          className="settings-input"
                          value={mk.key}
                          placeholder="modalresearch_..."
                          onChange={(e) => {
                            const v = e.target.value
                            setLocal(s => {
                              const keys = s.modalApiKeys.map(k => k.id === mk.id ? { ...k, key: v } : k)
                              // If editing first key, also sync principal
                              return idx === 0
                                ? { ...s, modalApiKey: v, modalApiKeys: keys }
                                : { ...s, modalApiKeys: keys }
                            })
                          }}
                          style={{ flex: 1, minWidth: 0 }}
                          disabled={idx === 0}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={mk.enabled}
                            onChange={(e) => {
                              const v = e.target.checked
                              setLocal(s => ({ ...s, modalApiKeys: s.modalApiKeys.map(k => k.id === mk.id ? { ...k, enabled: v } : k) }))
                            }}
                          />
                          {local.language === 'pt' ? 'Ativa' : 'On'}
                        </label>
                        {idx > 0 && (
                          <button
                            className="mcp-server-remove"
                            onClick={() => setLocal(s => ({ ...s, modalApiKeys: s.modalApiKeys.filter(k => k.id !== mk.id) }))}
                            title={local.language === 'pt' ? 'Remover' : 'Remove'}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      className="settings-fetch-btn"
                      onClick={() => setLocal(s => ({
                        ...s,
                        modalApiKeys: [...(s.modalApiKeys || []), { id: 'key-' + Date.now(), key: '', label: '', enabled: true }]
                      }))}
                      disabled={(local.modalApiKeys || []).length >= 10}
                      style={{ marginTop: '4px' }}
                    >
                      <Plus size={14} />
                      <span>{local.language === 'pt' ? 'Adicionar Key' : 'Add Key'}</span>
                    </button>
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #888)', marginTop: '6px' }}>
                      {local.language === 'pt'
                        ? `Pool atual: ${(local.modalApiKeys || []).filter(k => k.enabled && k.key).length} key(s) ativa(s) · max 10`
                        : `Current pool: ${(local.modalApiKeys || []).filter(k => k.enabled && k.key).length} active key(s) · max 10`}
                    </p>
                  </div>

                  <div className="settings-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={local.modalPoolFallbackOllama || false}
                        onChange={(e) => setLocal(s => ({ ...s, modalPoolFallbackOllama: e.target.checked }))}
                      />
                      <span>
                        {local.language === 'pt'
                          ? 'Fallback para Ollama se pool esgotar'
                          : 'Fallback to Ollama when pool is exhausted'}
                      </span>
                    </label>
                  </div>

                  <div className="settings-group">
                    <label className="settings-label"><span>Modelo Modal</span></label>
                    <input type="text" className="settings-input" list="modal-models" value={local.modalModel || ''}
                      onChange={(e) => setLocal(s => ({ ...s, modalModel: e.target.value }))} placeholder="zai-org/GLM-5.1-FP8" />
                    <datalist id="modal-models">
                      {(fetchedModels['modal'] || []).map(m => <option key={m} value={m} />)}
                      {!(fetchedModels['modal'] || []).length && <option value="zai-org/GLM-5.1-FP8" />}
                    </datalist>
                  </div>
                  <div className="settings-group">
                    <label className="settings-label"><span>Hostname Modal</span></label>
                    <input type="text" className="settings-input" value={local.modalHostname || ''}
                      onChange={(e) => setLocal(s => ({ ...s, modalHostname: e.target.value }))} placeholder="api.us-west-2.modal.direct" />
                  </div>
                  {fetchError && <div className="settings-fetch-error">{fetchError}</div>}
                </>
              )}
            </>
          )}

          {/* ── MCP TAB ── */}
          {activeTab === 'mcp' && (
            <>
              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'pt' ? 'Servidores MCP conectados' : 'Connected MCP Servers'}</span>
                </label>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #888)', marginBottom: '12px' }}>
                  {local.language === 'pt'
                    ? 'Adicione servidores MCP pelo nome e comando. Ex: npx -y @modelcontextprotocol/server-github'
                    : 'Add MCP servers by name and command. E.g.: npx -y @modelcontextprotocol/server-github'}
                </p>

                {/* Existing servers list */}
                {(local.mcpServers || []).length === 0 ? (
                  <div style={{ color: 'var(--color-text-muted, #888)', fontSize: '0.82rem', padding: '12px 0' }}>
                    {local.language === 'pt' ? 'Nenhum servidor configurado.' : 'No servers configured.'}
                  </div>
                ) : (
                  <div className="mcp-server-list">
                    {(local.mcpServers || []).map((srv, idx) => (
                      <div key={idx} className="mcp-server-item">
                        <div className="mcp-server-info">
                          <span className="mcp-server-name">{srv.name}</span>
                          <span className="mcp-server-cmd">{srv.command}</span>
                        </div>
                        <button
                          className="mcp-server-remove"
                          onClick={() => removeMcpServer(idx)}
                          title={local.language === 'pt' ? 'Remover' : 'Remove'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new server */}
                <div className="mcp-add-row">
                  <input
                    type="text"
                    className="settings-input"
                    placeholder={local.language === 'pt' ? 'Nome (ex: github)' : 'Name (e.g.: github)'}
                    value={newMcpName}
                    onChange={(e) => setNewMcpName(e.target.value)}
                    style={{ flex: '1', minWidth: 0 }}
                  />
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="npx -y @modelcontextprotocol/server-github"
                    value={newMcpCommand}
                    onChange={(e) => setNewMcpCommand(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addMcpServer() }}
                    style={{ flex: '2', minWidth: 0 }}
                  />
                  <button
                    className="settings-fetch-btn"
                    onClick={addMcpServer}
                    disabled={!newMcpName.trim() || !newMcpCommand.trim()}
                    title={local.language === 'pt' ? 'Adicionar servidor' : 'Add server'}
                  >
                    <Plus size={14} />
                    <span>{local.language === 'pt' ? 'Adicionar' : 'Add'}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="settings-footer">
          <button className="settings-cancel-btn" onClick={onClose}>Cancelar</button>
          <button className="settings-save-btn" onClick={handleSave}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
