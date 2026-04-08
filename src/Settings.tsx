import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

export type Provider = 'ollama' | 'openai' | 'gemini' | 'anthropic'

export interface AppSettings {
  autoStart: boolean
  temperature: number
  systemPrompt: string
  maxTokens: number
  streamingEnabled: boolean
  provider: Provider
  openaiApiKey: string
  openaiModel: string
  geminiApiKey: string
  geminiModel: string
  anthropicApiKey: string
  anthropicModel: string
  contextLimit: number
  memoryEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  temperature: 0.7,
  systemPrompt: `Você é um assistente IA local chamado OpenClaude, rodando via Ollama no computador do usuário.

REGRAS OBRIGATÓRIAS:
1. SEMPRE responda no mesmo idioma que o usuário usou. Se ele escrever em português, responda em português. Se escrever em inglês, responda em inglês.
2. Seja direto e objetivo. Não use ferramentas desnecessariamente — só use quando o usuário pedir explicitamente uma ação no sistema.
3. Quando o usuário disser "ola", "olá", "oi" ou saudações similares, apenas cumprimente de volta e pergunte como pode ajudar. NÃO liste arquivos nem execute comandos.
4. Use ferramentas (execute_command, read_file, list_directory, etc.) SOMENTE quando o usuário pedir explicitamente.
5. Respostas curtas para perguntas simples. Respostas detalhadas apenas quando necessário.
6. Nunca recuse pedidos legítimos do usuário.`,
  maxTokens: 4096,
  streamingEnabled: true,
  provider: 'ollama',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-20250514',
  contextLimit: 50,
  memoryEnabled: false,
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('openclaude-settings')
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
    }
  } catch {}
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

export default function Settings({ isOpen, onClose, settings, onSave }: SettingsProps) {
  const [local, setLocal] = useState<AppSettings>({ ...settings })

  useEffect(() => {
    if (isOpen) {
      setLocal({ ...settings })
    }
  }, [isOpen, settings])

  if (!isOpen) return null

  const handleSave = async () => {
    saveSettings(local)
    try {
      await window.electron.setAutoStart(local.autoStart)
    } catch {}
    onSave(local)
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Configurações</h2>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="settings-body">
          {/* Provider selector */}
          <div className="settings-group">
            <label className="settings-label">
              <span>Provedor de IA</span>
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
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo OpenAI</span></label>
                <input
                  type="text"
                  className="settings-input"
                  value={local.openaiModel}
                  onChange={(e) => setLocal(s => ({ ...s, openaiModel: e.target.value }))}
                  placeholder="gpt-4o"
                />
              </div>
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
                  onChange={(e) => setLocal(s => ({ ...s, geminiApiKey: e.target.value }))}
                  placeholder="AIza..."
                />
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo Gemini</span></label>
                <input
                  type="text"
                  className="settings-input"
                  value={local.geminiModel}
                  onChange={(e) => setLocal(s => ({ ...s, geminiModel: e.target.value }))}
                  placeholder="gemini-2.0-flash"
                />
              </div>
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
                  onChange={(e) => setLocal(s => ({ ...s, anthropicApiKey: e.target.value }))}
                  placeholder="sk-ant-..."
                />
              </div>
              <div className="settings-group">
                <label className="settings-label"><span>Modelo Anthropic</span></label>
                <input
                  type="text"
                  className="settings-input"
                  value={local.anthropicModel}
                  onChange={(e) => setLocal(s => ({ ...s, anthropicModel: e.target.value }))}
                  placeholder="claude-sonnet-4-20250514"
                />
              </div>
            </>
          )}

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
        </div>

        <div className="settings-footer">
          <button className="settings-cancel-btn" onClick={onClose}>Cancelar</button>
          <button className="settings-save-btn" onClick={handleSave}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
