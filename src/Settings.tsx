import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, Search } from 'lucide-react'
import { ProviderList } from './components/settings/ProviderList'
import { ProviderDetail } from './components/settings/ProviderDetail'
import { PROVIDERS } from './config/providers'

export type Provider = 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal' | 'custom'
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
  // ── Custom OpenAI-compatible provider (Groq, Together, DeepInfra, Fireworks…)
  customApiKey: string
  customModel: string
  customBaseUrl: string
  customLabel: string
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
  customApiKey: '',
  customModel: '',
  customBaseUrl: '',
  customLabel: 'Custom (OpenAI-compatible)',
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
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [newMcpName, setNewMcpName] = useState('')
  const [newMcpCommand, setNewMcpCommand] = useState('')
  // Provider tab state: which provider's detail pane is being edited
  // (not necessarily the one set as default).
  const [selectedProvider, setSelectedProvider] = useState<Provider>(settings.provider)
  const [providerSearch, setProviderSearch] = useState('')

  useEffect(() => {
    if (isOpen) {
      setLocal({ ...settings })
      setSelectedProvider(settings.provider)
    }
  }, [isOpen, settings])

  const filteredProviders = useMemo(() => {
    if (!providerSearch.trim()) return PROVIDERS
    const q = providerSearch.toLowerCase()
    return PROVIDERS.filter(p =>
      p.label.toLowerCase().includes(q) ||
      p.tagline.pt.toLowerCase().includes(q) ||
      p.tagline.en.toLowerCase().includes(q)
    )
  }, [providerSearch])

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

          {/* ── PROVIDER TAB (split view: list + detail) ── */}
          {activeTab === 'provider' && (
            <div className="provider-split">
              <aside className="provider-split-sidebar">
                <div className="provider-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder={local.language === 'pt' ? 'Buscar...' : 'Search...'}
                    value={providerSearch}
                    onChange={(e) => setProviderSearch(e.target.value)}
                    aria-label="Search providers"
                  />
                </div>
                <div className="provider-list-wrap">
                  {filteredProviders.length > 0 ? (
                    <ProviderList
                      settings={local}
                      selectedId={selectedProvider}
                      onSelect={setSelectedProvider}
                      activeProviderId={local.provider}
                    />
                  ) : (
                    <p className="provider-search-empty">
                      {local.language === 'pt' ? 'Nenhum resultado' : 'No results'}
                    </p>
                  )}
                </div>
              </aside>
              <div className="provider-split-detail">
                <ProviderDetail
                  providerId={selectedProvider}
                  settings={local}
                  setSettings={setLocal}
                  language={local.language}
                  isActiveDefault={local.provider === selectedProvider}
                  onMakeActive={() => setLocal(s => ({ ...s, provider: selectedProvider }))}
                />
                {selectedProvider === 'modal' && (
                  <div className="settings-group" style={{ marginTop: '16px' }}>
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
                )}
              </div>
            </div>
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
