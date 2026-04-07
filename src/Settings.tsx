import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

export interface AppSettings {
  autoStart: boolean
  temperature: number
  systemPrompt: string
  maxTokens: number
  streamingEnabled: boolean
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
          <h2>Configuracoes</h2>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="settings-body">
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
