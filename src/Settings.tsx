import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, Search } from 'lucide-react'
import { ProviderList } from './components/settings/ProviderList'
import { ProviderDetail } from './components/settings/ProviderDetail'
import { SubagentModelsPicker } from './components/settings/SubagentModelsPicker'
import { PROVIDERS } from './config/providers'

// Settings types, defaults and load/save moved to the boot-light
// settingsConfig module so App can pull loadSettings at startup without
// dragging this heavy modal into the boot bundle (it's lazy now). Re-export
// here so existing `… from './Settings'` imports keep working unchanged.
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings,
  type AppSettings, type Provider, type Language,
  type PermissionLevel, type McpServer, type ModalKey,
} from './settingsConfig'

export { DEFAULT_SETTINGS, loadSettings, saveSettings }
export type { AppSettings, Provider, Language, PermissionLevel, McpServer, ModalKey }

/** Status de conexão ao vivo de um servidor MCP (vindo do useMcp). */
export interface McpStatusInfo {
  name: string
  connected: boolean
  toolCount: number
  error?: string
}

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  /** Status ao vivo das conexões MCP (v2.42.0) — casado por nome do servidor. */
  mcpStatus?: McpStatusInfo[]
}

type SettingsTab = 'general' | 'provider' | 'mcp' | 'hooks'

export default function Settings({ isOpen, onClose, settings, onSave, mcpStatus = [] }: SettingsProps) {
  const [local, setLocal] = useState<AppSettings>({ ...settings })
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [newMcpName, setNewMcpName] = useState('')
  const [newMcpCommand, setNewMcpCommand] = useState('')
  const [newHookMatcher, setNewHookMatcher] = useState('')
  const [newHookCommand, setNewHookCommand] = useState('')
  const [newHookEvent, setNewHookEvent] = useState<'PostToolUse' | 'PreToolUse'>('PostToolUse')
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

  const addHook = () => {
    if (!newHookCommand.trim()) return
    setLocal(s => ({
      ...s,
      hooks: [...(s.hooks || []), { event: newHookEvent, matcher: (newHookMatcher.trim() || '*'), command: newHookCommand.trim() }],
    }))
    setNewHookMatcher('')
    setNewHookCommand('')
  }

  const removeHook = (idx: number) => {
    setLocal(s => ({ ...s, hooks: (s.hooks || []).filter((_, i) => i !== idx) }))
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: local.language === 'pt' ? 'Geral' : 'General' },
    { id: 'provider', label: local.language === 'pt' ? 'Provedor' : 'Provider' },
    { id: 'mcp', label: 'MCP' },
    { id: 'hooks', label: 'Hooks' },
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

              {/* Extended Thinking */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>Mostrar raciocínio (Extended Thinking)</span>
                  <div className={`toggle ${local.showThinking !== false ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, showThinking: s.showThinking === false }))}>
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

              {/* Semantic skill matching (Fase 5, v2.56.0) */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'en' ? 'Semantic skill matching (Ollama)' : 'Casamento semântico de skills (Ollama)'}</span>
                  <div className={`toggle ${local.semanticSkillMatch ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, semanticSkillMatch: !s.semanticSkillMatch }))}>
                    <div className="toggle-knob" />
                  </div>
                </label>
                <p className="settings-hint">
                  {local.language === 'en'
                    ? 'Surface skills by meaning, not just exact keyword (e.g. "alternative Tibia server" → otserv skill). Uses local Ollama embeddings; off by default (adds a small per-turn cost). Falls back to keyword if Ollama is offline.'
                    : 'Sugere skills por significado, não só pela palavra exata (ex.: "servidor de Tibia alternativo" → skill de otserv). Usa embeddings locais do Ollama; desligado por padrão (custo pequeno por turno). Cai no keyword se o Ollama estiver offline.'}
                </p>
              </div>

              {/* Tool deferral (v2.12.6) */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>
                    {local.language === 'pt'
                      ? 'Diferir schemas de ferramentas'
                      : 'Defer tool schemas'}
                  </span>
                  <div style={{ display: 'inline-flex', gap: 2, padding: 2, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} role="group">
                    {(['auto', 'on', 'off'] as const).map(m => {
                      const active = (local.toolDeferralMode ?? 'auto') === m
                      return (
                        <button key={m} type="button"
                          onClick={() => setLocal(s => ({ ...s, toolDeferralMode: m }))}
                          style={{
                            appearance: 'none', border: 0, cursor: 'pointer', font: 'inherit', fontSize: 12,
                            padding: '4px 12px', borderRadius: 6, transition: 'background .15s, color .15s',
                            background: active ? 'var(--accent, #7c5cff)' : 'transparent',
                            color: active ? '#fff' : 'var(--text-secondary, #9ca3af)',
                          }}>
                          {m === 'auto' ? 'Auto' : m === 'on'
                            ? (local.language === 'pt' ? 'Lig.' : 'On')
                            : (local.language === 'pt' ? 'Desl.' : 'Off')}
                        </button>
                      )
                    })}
                  </div>
                </label>
                <p className="settings-hint">
                  {local.language === 'pt'
                    ? 'Auto liga o diferimento quando os schemas das tools ocupariam ≥15% da janela do modelo — na prática, modelos de contexto pequeno (Ollama 8k). Tools diferidas viram nome+descrição no system prompt; o modelo chama tool_search sob demanda.'
                    : 'Auto enables deferral when tool schemas would take ≥15% of the model context — in practice, small-context models (Ollama 8k). Deferred tools become name+description in the system prompt; the model calls tool_search on demand.'}
                </p>
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

              {/* Janela de contexto do Ollama (num_ctx) — v2.24.0 */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'en' ? 'Ollama context window (num_ctx)' : 'Janela de contexto do Ollama (num_ctx)'}</span>
                  <span className="settings-value">{(local.ollamaNumCtx ?? 8192).toLocaleString()}</span>
                </label>
                <input
                  type="number"
                  min={2048}
                  max={131072}
                  step={2048}
                  value={local.ollamaNumCtx ?? 8192}
                  onChange={(e) => setLocal(s => ({ ...s, ollamaNumCtx: parseInt(e.target.value) || 8192 }))}
                  className="settings-input"
                />
                <p className="settings-hint">
                  {local.language === 'en'
                    ? 'Real context window sent to local Ollama models. The model\'s theoretical window (128k+) is impractical on a consumer GPU — too-large contexts overflow VRAM and time out. Raise only if your VRAM/model handles it.'
                    : 'Janela de contexto REAL enviada aos modelos locais do Ollama. A janela teórica do modelo (128k+) é inviável em GPU de consumidor — contexto grande demais estoura a VRAM e dá timeout. Aumente só se sua VRAM/modelo aguentar.'}
                </p>
              </div>

              {/* Esforço de raciocínio (v2.25.0) */}
              <div className="settings-group">
                <label className="settings-label">
                  <span>{local.language === 'en' ? 'Reasoning effort' : 'Esforço de raciocínio'}</span>
                </label>
                <select
                  value={local.reasoningEffort ?? 'default'}
                  onChange={(e) => setLocal(s => ({ ...s, reasoningEffort: e.target.value as AppSettings['reasoningEffort'] }))}
                  className="settings-input"
                >
                  <option value="default">{local.language === 'en' ? 'Provider default' : 'Padrão do provider'}</option>
                  <option value="auto">{local.language === 'en' ? 'Auto (adapts to the task)' : 'Automático (adapta à tarefa)'}</option>
                  <option value="off">{local.language === 'en' ? 'Off (faster)' : 'Desligado (mais rápido)'}</option>
                  <option value="low">{local.language === 'en' ? 'Low' : 'Baixo'}</option>
                  <option value="medium">{local.language === 'en' ? 'Medium' : 'Médio'}</option>
                  <option value="high">{local.language === 'en' ? 'High' : 'Alto'}</option>
                </select>
                <p className="settings-hint">
                  {local.language === 'en'
                    ? 'Controls how much the model "thinks". Auto scales effort per message to the task difficulty (local heuristic, no extra API call) — closest to how Claude employs effort on demand. Off skips reasoning (faster). Depth levels (low/medium/high) only apply where supported (OpenAI/Anthropic); GLM (Modal) and Ollama are on/off. Default sends nothing — provider behavior.'
                    : 'Controla quanto o modelo "pensa". Automático escala o esforço por mensagem conforme a dificuldade (heurística local, sem chamada extra) — o mais perto de como o Claude emprega esforço sob demanda. Desligado pula o raciocínio (mais rápido). Os níveis (baixo/médio/alto) só valem onde há suporte (OpenAI/Anthropic); GLM (Modal) e Ollama são liga/desliga. Padrão não envia nada — comportamento do provider.'}
                </p>
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

                {/* ── Subagentes de pesquisa (delegate_subtasks) v2.63.0 ── */}
                <div className="settings-group" style={{ marginTop: '16px' }}>
                  <label className="settings-label">
                    <span>{local.language === 'pt' ? 'Subagentes de pesquisa (delegate_subtasks)' : 'Research subagents (delegate_subtasks)'}</span>
                  </label>
                  <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #888)', margin: '4px 0 10px' }}>
                    {local.language === 'pt'
                      ? 'Cada subagente roda seu próprio loop de ferramentas de leitura (web_search, fetch_url, read_file, search_files) em paralelo. Recomendado: Ollama local (paralelo de verdade, grátis) enquanto o modelo principal orquestra.'
                      : 'Each subagent runs its own read-only tool loop (web_search, fetch_url, read_file, search_files) in parallel. Recommended: local Ollama (truly parallel, free) while the main model orchestrates.'}
                  </p>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={local.subagentExecutor || 'ollama'}
                      onChange={(e) => setLocal(s => ({ ...s, subagentExecutor: e.target.value as 'ollama' | 'modal' }))}
                      style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                    >
                      <option value="ollama">{local.language === 'pt' ? 'Ollama local (paralelo)' : 'Local Ollama (parallel)'}</option>
                      <option value="modal">{local.language === 'pt' ? 'Pool do Modal' : 'Modal pool'}</option>
                    </select>
                  </div>
                  {(local.subagentExecutor || 'ollama') === 'ollama' && (
                    <SubagentModelsPicker
                      selected={local.subagentModels || []}
                      onChange={(next) => setLocal(s => ({ ...s, subagentModels: next }))}
                      fallbackModel={local.subagentModel || 'llama3.2'}
                      onFallbackChange={(m) => setLocal(s => ({ ...s, subagentModel: m }))}
                      language={local.language}
                    />
                  )}
                </div>
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
                    {(local.mcpServers || []).map((srv, idx) => {
                      const st = mcpStatus.find(s => s.name === srv.name)
                      const dot = st?.connected ? 'var(--green, #52b788)' : st?.error ? 'var(--red, #e05c5c)' : 'var(--color-text-muted, #888)'
                      const label = st?.connected
                        ? (local.language === 'pt' ? `conectado · ${st.toolCount} tool(s)` : `connected · ${st.toolCount} tool(s)`)
                        : st?.error
                          ? (local.language === 'pt' ? `erro: ${st.error}` : `error: ${st.error}`)
                          : (local.language === 'pt' ? 'não conectado' : 'not connected')
                      return (
                      <div key={idx} className="mcp-server-item">
                        <div className="mcp-server-info">
                          <span className="mcp-server-name">
                            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: dot, marginRight: 7, verticalAlign: 'middle' }} />
                            {srv.name}
                          </span>
                          <span className="mcp-server-cmd">{srv.command}</span>
                          <span className="mcp-server-cmd" style={{ color: st?.error ? 'var(--red, #e05c5c)' : 'var(--color-text-muted, #888)' }}>{label}</span>
                        </div>
                        <button
                          className="mcp-server-remove"
                          onClick={() => removeMcpServer(idx)}
                          title={local.language === 'pt' ? 'Remover' : 'Remove'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      )
                    })}
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

          {/* ── HOOKS TAB ── */}
          {activeTab === 'hooks' && (
            <div className="settings-group">
              <label className="settings-label">
                <span>{local.language === 'pt' ? 'Hooks de ferramentas' : 'Tool hooks'}</span>
              </label>
              <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #888)', marginBottom: '12px' }}>
                {local.language === 'pt'
                  ? 'Comando shell em eventos de tool. PreToolUse roda ANTES (se sair com código ≠ 0, BLOQUEIA a tool; recebe OPENCLAUDE_TOOL_NAME/ARGS no env). PostToolUse roda DEPOIS do sucesso e anexa a saída ao resultado. Matcher: nome da tool (edit_file), prefixo (browser_*) ou *.'
                  : 'Shell command on tool events. PreToolUse runs BEFORE (non-zero exit BLOCKS the tool; gets OPENCLAUDE_TOOL_NAME/ARGS in env). PostToolUse runs AFTER success and appends output. Matcher: tool name (edit_file), prefix (browser_*) or *.'}
              </p>

              {(local.hooks || []).length === 0 ? (
                <div style={{ color: 'var(--color-text-muted, #888)', fontSize: '0.82rem', padding: '12px 0' }}>
                  {local.language === 'pt' ? 'Nenhum hook configurado.' : 'No hooks configured.'}
                </div>
              ) : (
                <div className="mcp-server-list">
                  {(local.hooks || []).map((hk, idx) => (
                    <div key={idx} className="mcp-server-item">
                      <div className="mcp-server-info">
                        <span className="mcp-server-name">{hk.event} · {hk.matcher}</span>
                        <span className="mcp-server-cmd">{hk.command}</span>
                      </div>
                      <button
                        className="mcp-server-remove"
                        onClick={() => removeHook(idx)}
                        title={local.language === 'pt' ? 'Remover' : 'Remove'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mcp-add-row">
                <select
                  className="settings-input"
                  value={newHookEvent}
                  onChange={(e) => setNewHookEvent(e.target.value as 'PostToolUse' | 'PreToolUse')}
                  style={{ flex: '0 0 auto', minWidth: 0 }}
                >
                  <option value="PostToolUse">PostToolUse</option>
                  <option value="PreToolUse">PreToolUse</option>
                </select>
                <input
                  type="text"
                  className="settings-input"
                  placeholder={local.language === 'pt' ? 'Matcher (ex.: edit_file ou *)' : 'Matcher (e.g. edit_file or *)'}
                  value={newHookMatcher}
                  onChange={(e) => setNewHookMatcher(e.target.value)}
                  style={{ flex: '1', minWidth: 0 }}
                />
                <input
                  type="text"
                  className="settings-input"
                  placeholder={local.language === 'pt' ? 'Comando (ex.: npx prettier -w .)' : 'Command (e.g. npx prettier -w .)'}
                  value={newHookCommand}
                  onChange={(e) => setNewHookCommand(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addHook() }}
                  style={{ flex: '2', minWidth: 0 }}
                />
                <button
                  className="settings-fetch-btn"
                  onClick={addHook}
                  disabled={!newHookCommand.trim()}
                  title={local.language === 'pt' ? 'Adicionar hook' : 'Add hook'}
                >
                  <Plus size={14} />
                  <span>{local.language === 'pt' ? 'Adicionar' : 'Add'}</span>
                </button>
              </div>
            </div>
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
