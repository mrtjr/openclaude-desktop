import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Camera, X, Send, Zap, RotateCcw, ChevronDown, Copy, MessageSquarePlus,
  Loader2, AlertCircle, ImageIcon, History, Keyboard
} from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface AppSettings {
  provider: 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal' | 'custom'
  openaiApiKey: string; openaiModel: string
  geminiApiKey: string; geminiModel: string
  anthropicApiKey: string; anthropicModel: string
  openrouterApiKey: string; openrouterModel: string
  modalApiKey: string; modalModel: string; modalHostname: string
  language: 'pt' | 'en'
  temperature: number; maxTokens: number
}

interface VisionModeProps {
  settings: AppSettings
  ollamaModels: string[]
  onClose: () => void
  onInsertToChat: (text: string) => void
}

interface CaptureEntry {
  id: string
  base64: string
  timestamp: number
  prompt: string
  response: string | null
}

const PRESET_PROMPTS = [
  'Explique este erro',
  'Descreva a interface',
  'Extraia o texto',
  'Analise o gráfico',
  'O que está errado aqui?',
]

function getApiKey(settings: AppSettings): string {
  switch (settings.provider) {
    case 'openai': return settings.openaiApiKey
    case 'gemini': return settings.geminiApiKey
    case 'anthropic': return settings.anthropicApiKey
    case 'openrouter': return settings.openrouterApiKey
    case 'modal': return settings.modalApiKey
    default: return ''
  }
}

function getModel(settings: AppSettings): string {
  switch (settings.provider) {
    case 'openai': return settings.openaiModel
    case 'gemini': return settings.geminiModel
    case 'anthropic': return settings.anthropicModel
    case 'openrouter': return settings.openrouterModel
    case 'modal': return settings.modalModel
    default: return 'llava'
  }
}

function renderMarkdown(text: string): string {
  const raw = marked(text, { breaks: true }) as string
  return DOMPurify.sanitize(raw)
}

export default function VisionMode({ settings, ollamaModels, onClose, onInsertToChat }: VisionModeProps) {
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('O que está na tela?')
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<CaptureEntry[]>([])
  const [selectedProvider, setSelectedProvider] = useState(settings.provider)
  const [selectedModel, setSelectedModel] = useState(getModel(settings))
  const [copied, setCopied] = useState(false)
  const responseRef = useRef<HTMLDivElement>(null)

  const providers: Array<'ollama' | 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'modal' | 'custom'> = [
    'ollama', 'openai', 'gemini', 'anthropic', 'openrouter', 'modal'
  ]

  useEffect(() => {
    setSelectedModel(getModel(settings))
  }, [settings])

  const handleCapture = useCallback(async () => {
    setCapturing(true)
    setError(null)
    try {
      const result = await window.electron.captureScreen()
      if (result.error) {
        setError(result.error)
      } else if (result.base64) {
        setCapturedImage(result.base64)
        setResponse(null)
      }
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao capturar tela')
    } finally {
      setCapturing(false)
    }
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!capturedImage) {
      setError('Capture a tela primeiro.')
      return
    }
    if (!prompt.trim()) {
      setError('Digite um prompt.')
      return
    }
    setLoading(true)
    setError(null)
    setResponse(null)

    const apiKey = selectedProvider === 'ollama'
      ? ''
      : (selectedProvider === 'openai' ? settings.openaiApiKey
        : selectedProvider === 'gemini' ? settings.geminiApiKey
        : selectedProvider === 'anthropic' ? settings.anthropicApiKey
        : selectedProvider === 'openrouter' ? settings.openrouterApiKey
        : settings.modalApiKey)

    try {
      const result = await window.electron.visionChat({
        provider: selectedProvider,
        apiKey,
        model: selectedModel,
        prompt: prompt.trim(),
        imageBase64: capturedImage,
        modalHostname: settings.modalHostname,
      })
      if (result.error) {
        setError(result.error)
      } else if (result.response) {
        setResponse(result.response)
        const entry: CaptureEntry = {
          id: Date.now().toString(),
          base64: capturedImage,
          timestamp: Date.now(),
          prompt: prompt.trim(),
          response: result.response,
        }
        setHistory(prev => [entry, ...prev].slice(0, 5))
      }
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao analisar imagem')
    } finally {
      setLoading(false)
    }
  }, [capturedImage, prompt, selectedProvider, selectedModel, settings])

  const handleRestoreHistory = (entry: CaptureEntry) => {
    setCapturedImage(entry.base64)
    setPrompt(entry.prompt)
    setResponse(entry.response)
    setError(null)
  }

  const handleCopy = () => {
    if (!response) return
    navigator.clipboard.writeText(response)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleInsert = () => {
    if (!response) return
    onInsertToChat(response)
    onClose()
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="vision-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vision-modal">
        {/* Header */}
        <div className="vision-header">
          <div className="vision-header-left">
            <div className="vision-icon-wrap">
              <Camera size={18} />
            </div>
            <div>
              <h2 className="vision-title">Vision Mode</h2>
              <p className="vision-subtitle">Análise de tela com IA</p>
            </div>
          </div>
          <button className="vision-close" onClick={onClose} title="Fechar (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Hotkey hint */}
        <div className="vision-hotkey-bar">
          <Keyboard size={12} />
          <span>Ctrl+Shift+V para capturar de qualquer lugar</span>
        </div>

        <div className="vision-body">
          {/* LEFT COLUMN */}
          <div className="vision-left">
            {/* History strip */}
            {history.length > 0 && (
              <div className="vision-history-strip">
                <div className="vision-history-label">
                  <History size={12} />
                  <span>Histórico</span>
                </div>
                <div className="vision-history-thumbs">
                  {history.map(entry => (
                    <button
                      key={entry.id}
                      className="vision-history-thumb"
                      onClick={() => handleRestoreHistory(entry)}
                      title={entry.prompt}
                    >
                      <img src={`data:image/png;base64,${entry.base64}`} alt="histórico" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Screenshot preview */}
            <div className={`vision-preview-area ${!capturedImage ? 'vision-preview-empty' : ''}`}>
              {capturedImage ? (
                <img
                  src={`data:image/png;base64,${capturedImage}`}
                  alt="Captura de tela"
                  className="vision-screenshot"
                />
              ) : (
                <div className="vision-preview-placeholder">
                  <ImageIcon size={36} />
                  <p>Clique em Capturar Tela</p>
                  <span>A captura aparecerá aqui</span>
                </div>
              )}
            </div>

            {/* Capture button */}
            <button
              className="vision-capture-btn"
              onClick={handleCapture}
              disabled={capturing}
            >
              {capturing ? (
                <><Loader2 size={16} className="vision-spin" /> Capturando…</>
              ) : (
                <><Camera size={16} /> Capturar Tela</>
              )}
            </button>
          </div>

          {/* RIGHT COLUMN */}
          <div className="vision-right">
            {/* Model selection */}
            <div className="vision-section">
              <label className="vision-label">Provedor & Modelo</label>
              <div className="vision-model-row">
                <div className="vision-select-wrap">
                  <select
                    className="vision-select"
                    value={selectedProvider}
                    onChange={e => setSelectedProvider(e.target.value as any)}
                  >
                    {providers.map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="vision-select-icon" />
                </div>
                {selectedProvider === 'ollama' ? (
                  <div className="vision-select-wrap">
                    <select
                      className="vision-select"
                      value={selectedModel}
                      onChange={e => setSelectedModel(e.target.value)}
                    >
                      {ollamaModels.length > 0
                        ? ollamaModels.map(m => <option key={m} value={m}>{m}</option>)
                        : <option value="llava">llava</option>}
                    </select>
                    <ChevronDown size={14} className="vision-select-icon" />
                  </div>
                ) : (
                  <input
                    className="vision-model-input"
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    placeholder="Nome do modelo"
                  />
                )}
              </div>
            </div>

            {/* Preset prompts */}
            <div className="vision-section">
              <label className="vision-label">Prompts rápidos</label>
              <div className="vision-presets">
                {PRESET_PROMPTS.map(p => (
                  <button
                    key={p}
                    className={`vision-preset-btn ${prompt === p ? 'vision-preset-active' : ''}`}
                    onClick={() => setPrompt(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt input */}
            <div className="vision-section">
              <label className="vision-label">Pergunta</label>
              <textarea
                className="vision-prompt-input"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="O que você quer saber sobre a tela?"
                rows={3}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAnalyze()
                }}
              />
              <p className="vision-input-hint">Ctrl+Enter para analisar</p>
            </div>

            {/* Analyze button */}
            <button
              className="vision-analyze-btn"
              onClick={handleAnalyze}
              disabled={loading || !capturedImage}
            >
              {loading ? (
                <><Loader2 size={16} className="vision-spin" /> Analisando…</>
              ) : (
                <><Zap size={16} /> Analisar</>
              )}
            </button>

            {/* Error */}
            {error && (
              <div className="vision-error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {/* Response */}
            {response && (
              <div className="vision-response-wrap">
                <div className="vision-response-header">
                  <span className="vision-response-label">Resposta</span>
                  <div className="vision-response-actions">
                    <button className="vision-action-btn" onClick={handleCopy} title="Copiar">
                      <Copy size={13} />
                      {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                    <button className="vision-action-btn vision-action-insert" onClick={handleInsert} title="Inserir no chat">
                      <MessageSquarePlus size={13} />
                      Inserir no chat
                    </button>
                  </div>
                </div>
                <div
                  ref={responseRef}
                  className="vision-response-content markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(response) }}
                />
              </div>
            )}

            {/* Empty state */}
            {!response && !loading && !error && (
              <div className="vision-empty-response">
                <Send size={24} />
                <p>Capture a tela e clique em Analisar</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .vision-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(6px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .vision-modal {
          background: var(--bg-secondary, #13131f);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 16px;
          width: 100%;
          max-width: 900px;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        }
        .vision-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
          flex-shrink: 0;
        }
        .vision-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .vision-icon-wrap {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, #f97316, #a855f7);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }
        .vision-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary, #f1f1f1);
          margin: 0;
        }
        .vision-subtitle {
          font-size: 12px;
          color: var(--text-secondary, #888);
          margin: 0;
        }
        .vision-close {
          background: none;
          border: none;
          color: var(--text-secondary, #888);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          transition: color 0.15s, background 0.15s;
        }
        .vision-close:hover {
          color: var(--text-primary, #f1f1f1);
          background: rgba(255,255,255,0.06);
        }
        .vision-hotkey-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 20px;
          background: rgba(249,115,22,0.06);
          border-bottom: 1px solid rgba(249,115,22,0.12);
          color: #f97316;
          font-size: 11px;
          flex-shrink: 0;
        }
        .vision-body {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        .vision-left {
          width: 400px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
          overflow-y: auto;
        }
        .vision-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
          overflow-y: auto;
        }
        /* History */
        .vision-history-strip {
          flex-shrink: 0;
        }
        .vision-history-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin-bottom: 8px;
        }
        .vision-history-thumbs {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .vision-history-thumb {
          width: 64px;
          height: 40px;
          border-radius: 6px;
          overflow: hidden;
          border: 2px solid var(--border-color, rgba(255,255,255,0.08));
          cursor: pointer;
          flex-shrink: 0;
          padding: 0;
          background: none;
          transition: border-color 0.15s;
        }
        .vision-history-thumb:hover {
          border-color: #f97316;
        }
        .vision-history-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        /* Preview */
        .vision-preview-area {
          flex: 1;
          min-height: 200px;
          border-radius: 10px;
          overflow: hidden;
          background: var(--bg-primary, #0d0d17);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vision-preview-empty {
          border: 2px dashed var(--border-color, rgba(255,255,255,0.08));
        }
        .vision-preview-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary, #888);
          text-align: center;
        }
        .vision-preview-placeholder p {
          font-size: 14px;
          margin: 0;
        }
        .vision-preview-placeholder span {
          font-size: 11px;
          opacity: 0.6;
        }
        .vision-screenshot {
          width: 100%;
          height: 100%;
          object-fit: contain;
          max-height: 320px;
        }
        .vision-capture-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #f97316, #a855f7);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
          flex-shrink: 0;
        }
        .vision-capture-btn:hover:not(:disabled) {
          opacity: 0.9;
          transform: translateY(-1px);
        }
        .vision-capture-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        /* Right panel */
        .vision-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .vision-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary, #888);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .vision-model-row {
          display: flex;
          gap: 8px;
        }
        .vision-select-wrap {
          position: relative;
          flex: 1;
        }
        .vision-select {
          width: 100%;
          appearance: none;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          color: var(--text-primary, #f1f1f1);
          padding: 8px 30px 8px 10px;
          font-size: 13px;
          cursor: pointer;
        }
        .vision-select:focus {
          outline: none;
          border-color: #f97316;
        }
        .vision-select-icon {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: var(--text-secondary, #888);
        }
        .vision-model-input {
          flex: 1;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          color: var(--text-primary, #f1f1f1);
          padding: 8px 10px;
          font-size: 13px;
        }
        .vision-model-input:focus {
          outline: none;
          border-color: #f97316;
        }
        .vision-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .vision-preset-btn {
          padding: 5px 10px;
          border-radius: 20px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: transparent;
          color: var(--text-secondary, #888);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .vision-preset-btn:hover {
          border-color: #f97316;
          color: #f97316;
        }
        .vision-preset-active {
          border-color: #f97316 !important;
          background: rgba(249,115,22,0.1) !important;
          color: #f97316 !important;
        }
        .vision-prompt-input {
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          color: var(--text-primary, #f1f1f1);
          padding: 10px;
          font-size: 13px;
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
        }
        .vision-prompt-input:focus {
          outline: none;
          border-color: #f97316;
        }
        .vision-input-hint {
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin: 0;
        }
        .vision-analyze-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #f97316, #a855f7);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
          flex-shrink: 0;
        }
        .vision-analyze-btn:hover:not(:disabled) {
          opacity: 0.9;
          transform: translateY(-1px);
        }
        .vision-analyze-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .vision-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          color: #ef4444;
          font-size: 13px;
        }
        .vision-response-wrap {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }
        .vision-response-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .vision-response-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary, #888);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .vision-response-actions {
          display: flex;
          gap: 6px;
        }
        .vision-action-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: transparent;
          color: var(--text-secondary, #888);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .vision-action-btn:hover {
          border-color: rgba(255,255,255,0.2);
          color: var(--text-primary, #f1f1f1);
        }
        .vision-action-insert {
          border-color: rgba(168,85,247,0.3);
          color: #a855f7;
        }
        .vision-action-insert:hover {
          background: rgba(168,85,247,0.1);
          border-color: #a855f7;
          color: #a855f7 !important;
        }
        .vision-response-content {
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 10px;
          padding: 14px;
          font-size: 13px;
          line-height: 1.6;
          color: var(--text-primary, #f1f1f1);
          overflow-y: auto;
          max-height: 300px;
        }
        .vision-response-content p { margin: 0 0 8px; }
        .vision-response-content p:last-child { margin-bottom: 0; }
        .vision-response-content code {
          background: rgba(255,255,255,0.06);
          border-radius: 4px;
          padding: 1px 5px;
          font-family: monospace;
          font-size: 12px;
        }
        .vision-response-content pre {
          background: rgba(255,255,255,0.04);
          border-radius: 8px;
          padding: 12px;
          overflow-x: auto;
        }
        .vision-empty-response {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-secondary, #888);
          opacity: 0.5;
          text-align: center;
        }
        .vision-empty-response p {
          margin: 0;
          font-size: 13px;
        }
        .vision-spin {
          animation: vision-rotate 1s linear infinite;
        }
        @keyframes vision-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
