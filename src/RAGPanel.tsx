import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Database, Plus, Search, Trash2, FileText, AlignLeft,
  Loader2, AlertCircle, CheckCircle2, ChevronDown, ToggleLeft, ToggleRight,
  Upload, RefreshCw
} from 'lucide-react'

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

interface RAGPanelProps {
  settings: AppSettings
  ollamaModels: string[]
  onClose: () => void
  ragEnabled: boolean
  onToggleRAG: (enabled: boolean) => void
}

interface RagChunk {
  id: string
  source: string
  content: string
  embedding: number[]
  chunkIndex: number
  addedAt: number
}

interface RagFile {
  name: string
  chunks: number
  addedAt: number
  source: string
}

interface SearchResult {
  text: string
  score: number
  source: string
}

function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize))
    start += chunkSize - overlap
  }
  return chunks.filter(c => c.trim().length > 20)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function RAGPanel({
  settings, ollamaModels, onClose, ragEnabled, onToggleRAG
}: RAGPanelProps) {
  const [tab, setTab] = useState<'text' | 'file'>('text')
  const [textInput, setTextInput] = useState('')
  const [textSource, setTextSource] = useState('texto-manual')
  const [embeddingModel, setEmbeddingModel] = useState('mxbai-embed-large')
  const [allChunks, setAllChunks] = useState<RagChunk[]>([])
  const [files, setFiles] = useState<RagFile[]>([])
  const [indexing, setIndexing] = useState(false)
  const [indexProgress, setIndexProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [droppedFile, setDroppedFile] = useState<{ name: string; content: string; size: number } | null>(null)
  const [loadingIndex, setLoadingIndex] = useState(true)
  const dropRef = useRef<HTMLDivElement>(null)

  // Load index on mount
  useEffect(() => {
    loadIndex()
  }, [])

  const loadIndex = async () => {
    setLoadingIndex(true)
    try {
      const result = await window.electron.ragIndexLoad()
      const chunks = (result.chunks || []) as RagChunk[]
      setAllChunks(chunks)
      rebuildFileList(chunks)
    } catch (e: any) {
      setError('Erro ao carregar índice: ' + (e?.message ?? ''))
    } finally {
      setLoadingIndex(false)
    }
  }

  const rebuildFileList = (chunks: RagChunk[]) => {
    const map = new Map<string, RagFile>()
    for (const c of chunks) {
      if (!map.has(c.source)) {
        map.set(c.source, { name: c.source, chunks: 0, addedAt: c.addedAt, source: c.source })
      }
      const f = map.get(c.source)!
      f.chunks++
      if (c.addedAt < f.addedAt) f.addedAt = c.addedAt
    }
    setFiles(Array.from(map.values()).sort((a, b) => b.addedAt - a.addedAt))
  }

  const saveChunks = async (chunks: RagChunk[]) => {
    const result = await window.electron.ragIndexSave(chunks)
    if (result.error) throw new Error(result.error)
  }

  const showSuccess = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  const indexText = useCallback(async (text: string, source: string) => {
    if (!text.trim()) { setError('Digite algum conteúdo primeiro.'); return }
    setIndexing(true)
    setError(null)
    const chunks = chunkText(text)
    setIndexProgress({ current: 0, total: chunks.length })

    const newChunks: RagChunk[] = []
    try {
      for (let i = 0; i < chunks.length; i++) {
        const embedResult = await window.electron.ragEmbed({ model: embeddingModel, text: chunks[i] })
        if (embedResult.error) throw new Error(embedResult.error)
        newChunks.push({
          id: `${source}-${Date.now()}-${i}`,
          source,
          content: chunks[i],
          embedding: embedResult.embedding,
          chunkIndex: i,
          addedAt: Date.now(),
        })
        setIndexProgress({ current: i + 1, total: chunks.length })
      }
      const combined = [...allChunks, ...newChunks]
      await saveChunks(combined)
      setAllChunks(combined)
      rebuildFileList(combined)
      showSuccess(`${newChunks.length} chunks indexados de "${source}"`)
    } catch (e: any) {
      setError('Erro ao indexar: ' + (e?.message ?? ''))
    } finally {
      setIndexing(false)
      setIndexProgress(null)
    }
  }, [allChunks, embeddingModel])

  const handleIndexText = () => indexText(textInput, textSource || 'texto-manual')

  const handleFileIndex = () => {
    if (!droppedFile) { setError('Nenhum arquivo selecionado.'); return }
    indexText(droppedFile.content, droppedFile.name)
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const path = (file as any).path || ''
    if (path) {
      const result = await window.electron.readFile(path)
      if (result.error) { setError(result.error); return }
      setDroppedFile({ name: file.name, content: result.content ?? '', size: file.size })
    } else {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setDroppedFile({ name: file.name, content: ev.target?.result as string ?? '', size: file.size })
      }
      reader.readAsText(file)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = (file as any).path || ''
    if (path) {
      const result = await window.electron.readFile(path)
      if (result.error) { setError(result.error); return }
      setDroppedFile({ name: file.name, content: result.content ?? '', size: file.size })
    } else {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setDroppedFile({ name: file.name, content: ev.target?.result as string ?? '', size: file.size })
      }
      reader.readAsText(file)
    }
  }

  const handleRemoveSource = async (source: string) => {
    const filtered = allChunks.filter(c => c.source !== source)
    try {
      await saveChunks(filtered)
      setAllChunks(filtered)
      rebuildFileList(filtered)
      showSuccess(`"${source}" removido do índice`)
    } catch (e: any) {
      setError('Erro ao remover: ' + (e?.message ?? ''))
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setError(null)
    setSearchResults([])
    try {
      const embedResult = await window.electron.ragEmbed({ model: embeddingModel, text: searchQuery })
      if (embedResult.error) throw new Error(embedResult.error)
      const searchResult = await window.electron.ragSearch({ queryEmbedding: embedResult.embedding, topK: 5 })
      setSearchResults(searchResult.results || [])
    } catch (e: any) {
      setError('Erro na busca: ' + (e?.message ?? ''))
    } finally {
      setSearching(false)
    }
  }

  const handleClearAll = async () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); return }
    try {
      const result = await window.electron.ragClear()
      if (result.error) throw new Error(result.error)
      setAllChunks([])
      setFiles([])
      setSearchResults([])
      setConfirmClear(false)
      showSuccess('Índice limpo com sucesso')
    } catch (e: any) {
      setError('Erro ao limpar: ' + (e?.message ?? ''))
    }
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const totalChunks = allChunks.length

  return (
    <div className="rag-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rag-modal">
        {/* Header */}
        <div className="rag-header">
          <div className="rag-header-left">
            <div className="rag-icon-wrap">
              <Database size={18} />
            </div>
            <div>
              <h2 className="rag-title">Base de Conhecimento RAG</h2>
              <p className="rag-subtitle">{totalChunks} chunks indexados · {files.length} fontes</p>
            </div>
          </div>
          <div className="rag-header-right">
            <button
              className={`rag-toggle-btn ${ragEnabled ? 'rag-toggle-on' : ''}`}
              onClick={() => onToggleRAG(!ragEnabled)}
              title={ragEnabled ? 'Desativar injeção RAG' : 'Ativar injeção RAG'}
            >
              {ragEnabled
                ? <><ToggleRight size={18} /> RAG Ativo</>
                : <><ToggleLeft size={18} /> RAG Inativo</>
              }
            </button>
            <button className="rag-icon-btn" onClick={loadIndex} title="Recarregar índice">
              <RefreshCw size={14} />
            </button>
            <button className="rag-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Toggle description */}
        {ragEnabled && (
          <div className="rag-active-bar">
            <CheckCircle2 size={12} />
            Contexto RAG será injetado automaticamente em cada mensagem enviada
          </div>
        )}

        <div className="rag-body">
          {/* LEFT: Add content + index status */}
          <div className="rag-left">
            {/* Embedding model */}
            <div className="rag-section">
              <label className="rag-label">Modelo de embedding</label>
              <div className="rag-select-wrap">
                {ollamaModels.length > 0 ? (
                  <>
                    <select
                      className="rag-select"
                      value={embeddingModel}
                      onChange={e => setEmbeddingModel(e.target.value)}
                    >
                      {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <ChevronDown size={13} className="rag-select-icon" />
                  </>
                ) : (
                  <input
                    className="rag-input"
                    value={embeddingModel}
                    onChange={e => setEmbeddingModel(e.target.value)}
                    placeholder="mxbai-embed-large"
                  />
                )}
              </div>
              <p className="rag-hint">Use mxbai-embed-large ou nomic-embed-text</p>
            </div>

            {/* Tabs */}
            <div className="rag-section">
              <div className="rag-tabs">
                <button
                  className={`rag-tab ${tab === 'text' ? 'rag-tab-active' : ''}`}
                  onClick={() => setTab('text')}
                >
                  <AlignLeft size={13} /> Adicionar texto
                </button>
                <button
                  className={`rag-tab ${tab === 'file' ? 'rag-tab-active' : ''}`}
                  onClick={() => setTab('file')}
                >
                  <FileText size={13} /> Adicionar arquivo
                </button>
              </div>

              {tab === 'text' && (
                <div className="rag-tab-content">
                  <input
                    className="rag-input"
                    value={textSource}
                    onChange={e => setTextSource(e.target.value)}
                    placeholder="Nome da fonte (ex: documentação)"
                  />
                  <textarea
                    className="rag-textarea"
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    placeholder="Cole o texto que deseja indexar…"
                    rows={7}
                  />
                  <div className="rag-meta-row">
                    <span className="rag-meta-text">
                      {textInput.length > 0 && `~${chunkText(textInput).length} chunks · ${textInput.length} chars`}
                    </span>
                    <button
                      className="rag-primary-btn"
                      onClick={handleIndexText}
                      disabled={indexing || !textInput.trim()}
                    >
                      {indexing ? <Loader2 size={13} className="rag-spin" /> : <Plus size={13} />}
                      Indexar
                    </button>
                  </div>
                </div>
              )}

              {tab === 'file' && (
                <div className="rag-tab-content">
                  <div
                    ref={dropRef}
                    className={`rag-drop-zone ${droppedFile ? 'rag-drop-zone-filled' : ''}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDrop}
                  >
                    {droppedFile ? (
                      <div className="rag-dropped-file">
                        <FileText size={20} />
                        <div>
                          <p className="rag-dropped-name">{droppedFile.name}</p>
                          <p className="rag-dropped-meta">
                            {formatSize(droppedFile.size)} · ~{chunkText(droppedFile.content).length} chunks
                          </p>
                        </div>
                        <button
                          className="rag-icon-btn"
                          onClick={() => setDroppedFile(null)}
                          title="Remover"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload size={24} />
                        <p>Arraste um arquivo aqui</p>
                        <span>ou</span>
                        <label className="rag-file-picker">
                          Selecionar arquivo
                          <input type="file" accept=".txt,.md,.json,.csv,.js,.ts,.py,.html,.css" onChange={handleFileInput} style={{ display: 'none' }} />
                        </label>
                      </>
                    )}
                  </div>
                  <div className="rag-meta-row">
                    <span />
                    <button
                      className="rag-primary-btn"
                      onClick={handleFileIndex}
                      disabled={indexing || !droppedFile}
                    >
                      {indexing ? <Loader2 size={13} className="rag-spin" /> : <Plus size={13} />}
                      Indexar arquivo
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Progress */}
            {indexProgress && (
              <div className="rag-progress-wrap">
                <div className="rag-progress-label">
                  <span>Indexando chunk {indexProgress.current} / {indexProgress.total}</span>
                  <span>{Math.round((indexProgress.current / indexProgress.total) * 100)}%</span>
                </div>
                <div className="rag-progress-bar">
                  <div
                    className="rag-progress-fill"
                    style={{ width: `${(indexProgress.current / indexProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Status messages */}
            {error && (
              <div className="rag-error">
                <AlertCircle size={13} /> {error}
              </div>
            )}
            {success && (
              <div className="rag-success">
                <CheckCircle2 size={13} /> {success}
              </div>
            )}

            {/* Index status */}
            <div className="rag-section">
              <div className="rag-section-header">
                <label className="rag-label">Fontes indexadas ({files.length})</label>
                {files.length > 0 && (
                  <button
                    className={`rag-clear-btn ${confirmClear ? 'rag-clear-confirm' : ''}`}
                    onClick={handleClearAll}
                  >
                    <Trash2 size={12} />
                    {confirmClear ? 'Confirmar limpeza?' : 'Limpar índice'}
                  </button>
                )}
              </div>
              {loadingIndex ? (
                <div className="rag-loading"><Loader2 size={16} className="rag-spin" /> Carregando índice…</div>
              ) : files.length === 0 ? (
                <div className="rag-empty-list">Nenhuma fonte indexada ainda</div>
              ) : (
                <div className="rag-file-list">
                  {files.map(file => (
                    <div key={file.source} className="rag-file-item">
                      <div className="rag-file-info">
                        <FileText size={13} />
                        <div>
                          <p className="rag-file-name">{file.name}</p>
                          <p className="rag-file-meta">{file.chunks} chunks · {formatDate(file.addedAt)}</p>
                        </div>
                      </div>
                      <button
                        className="rag-remove-btn"
                        onClick={() => handleRemoveSource(file.source)}
                        title="Remover fonte"
                      >
                        <Trash2 size={12} />
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Test search */}
          <div className="rag-right">
            <div className="rag-section">
              <label className="rag-label">Teste de busca semântica</label>
              <div className="rag-search-row">
                <input
                  className="rag-input rag-search-input"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Digite uma pergunta para buscar no índice…"
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
                />
                <button
                  className="rag-search-btn"
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim() || totalChunks === 0}
                >
                  {searching ? <Loader2 size={14} className="rag-spin" /> : <Search size={14} />}
                  Buscar
                </button>
              </div>
            </div>

            {searchResults.length > 0 && (
              <div className="rag-section">
                <label className="rag-label">Resultados (top {searchResults.length})</label>
                <div className="rag-results-list">
                  {searchResults.map((r, i) => (
                    <div key={i} className="rag-result-item">
                      <div className="rag-result-header">
                        <span className="rag-result-rank">#{i + 1}</span>
                        <span className="rag-result-source">{r.source}</span>
                        <span className="rag-result-score">{(r.score * 100).toFixed(1)}%</span>
                      </div>
                      <div className="rag-result-score-bar">
                        <div
                          className="rag-result-score-fill"
                          style={{ width: `${Math.max(r.score * 100, 2)}%` }}
                        />
                      </div>
                      <p className="rag-result-text">{r.text.slice(0, 200)}{r.text.length > 200 ? '…' : ''}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {searchResults.length === 0 && !searching && (
              <div className="rag-search-empty">
                <Search size={28} />
                <p>Teste a busca semântica</p>
                <span>Os resultados mostrarão os chunks mais relevantes com pontuação de similaridade</span>
              </div>
            )}

            {/* Info box */}
            <div className="rag-info-box">
              <p className="rag-info-title">Como funciona o RAG</p>
              <ul className="rag-info-list">
                <li>Textos são divididos em chunks de ~500 caracteres com 50 de sobreposição</li>
                <li>Cada chunk é convertido em um embedding vetorial pelo modelo selecionado</li>
                <li>Quando o RAG está ativo, a busca semântica é executada antes de cada mensagem</li>
                <li>Os chunks mais relevantes são injetados no contexto do sistema</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .rag-overlay {
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
        .rag-modal {
          background: var(--bg-secondary, #13131f);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 16px;
          width: 100%;
          max-width: 920px;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        }
        .rag-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
          flex-shrink: 0;
        }
        .rag-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rag-icon-wrap {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, #f97316, #a855f7);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }
        .rag-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary, #f1f1f1);
          margin: 0;
        }
        .rag-subtitle {
          font-size: 12px;
          color: var(--text-secondary, #888);
          margin: 0;
        }
        .rag-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .rag-toggle-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 20px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: transparent;
          color: var(--text-secondary, #888);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
        }
        .rag-toggle-on {
          border-color: rgba(34,197,94,0.4);
          background: rgba(34,197,94,0.08);
          color: #22c55e;
        }
        .rag-icon-btn {
          background: none;
          border: none;
          color: var(--text-secondary, #888);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s, background 0.15s;
        }
        .rag-icon-btn:hover {
          color: var(--text-primary, #f1f1f1);
          background: rgba(255,255,255,0.06);
        }
        .rag-active-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 20px;
          background: rgba(34,197,94,0.08);
          border-bottom: 1px solid rgba(34,197,94,0.15);
          color: #22c55e;
          font-size: 12px;
          flex-shrink: 0;
        }
        .rag-body {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        .rag-left {
          width: 420px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
          border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
          overflow-y: auto;
        }
        .rag-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
          overflow-y: auto;
        }
        .rag-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .rag-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .rag-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary, #888);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .rag-hint {
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin: 0;
          opacity: 0.7;
        }
        .rag-select-wrap {
          position: relative;
        }
        .rag-select {
          width: 100%;
          appearance: none;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          color: var(--text-primary, #f1f1f1);
          padding: 8px 30px 8px 10px;
          font-size: 13px;
        }
        .rag-select:focus { outline: none; border-color: #f97316; }
        .rag-select-icon {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: var(--text-secondary, #888);
        }
        .rag-input {
          width: 100%;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          color: var(--text-primary, #f1f1f1);
          padding: 8px 10px;
          font-size: 13px;
          box-sizing: border-box;
        }
        .rag-input:focus { outline: none; border-color: #f97316; }
        .rag-textarea {
          width: 100%;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          color: var(--text-primary, #f1f1f1);
          padding: 10px;
          font-size: 13px;
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
          box-sizing: border-box;
        }
        .rag-textarea:focus { outline: none; border-color: #f97316; }
        .rag-tabs {
          display: flex;
          gap: 2px;
          background: var(--bg-primary, #0d0d17);
          border-radius: 8px;
          padding: 3px;
        }
        .rag-tab {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 7px 10px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: var(--text-secondary, #888);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .rag-tab-active {
          background: var(--bg-secondary, #13131f);
          color: var(--text-primary, #f1f1f1);
        }
        .rag-tab-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .rag-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .rag-meta-text {
          font-size: 11px;
          color: var(--text-secondary, #888);
        }
        .rag-primary-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #f97316, #a855f7);
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .rag-primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .rag-drop-zone {
          border: 2px dashed var(--border-color, rgba(255,255,255,0.08));
          border-radius: 10px;
          padding: 28px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary, #888);
          font-size: 13px;
          text-align: center;
          transition: border-color 0.15s;
          cursor: pointer;
        }
        .rag-drop-zone:hover { border-color: rgba(249,115,22,0.4); }
        .rag-drop-zone-filled {
          border-style: solid;
          border-color: rgba(249,115,22,0.3);
          padding: 14px 16px;
        }
        .rag-dropped-file {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
        }
        .rag-dropped-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary, #f1f1f1);
          margin: 0;
        }
        .rag-dropped-meta {
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin: 0;
        }
        .rag-file-picker {
          padding: 6px 14px;
          border-radius: 6px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          color: var(--text-primary, #f1f1f1);
          font-size: 12px;
          cursor: pointer;
          transition: border-color 0.15s;
        }
        .rag-file-picker:hover { border-color: #f97316; }
        .rag-progress-wrap {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .rag-progress-label {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--text-secondary, #888);
        }
        .rag-progress-bar {
          height: 4px;
          background: rgba(255,255,255,0.06);
          border-radius: 4px;
          overflow: hidden;
        }
        .rag-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #f97316, #a855f7);
          border-radius: 4px;
          transition: width 0.3s;
        }
        .rag-error {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          padding: 9px 12px;
          border-radius: 8px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.2);
          color: #ef4444;
          font-size: 12px;
        }
        .rag-success {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          padding: 9px 12px;
          border-radius: 8px;
          background: rgba(34,197,94,0.08);
          border: 1px solid rgba(34,197,94,0.2);
          color: #22c55e;
          font-size: 12px;
        }
        .rag-loading {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary, #888);
          font-size: 13px;
          padding: 12px 0;
        }
        .rag-empty-list {
          font-size: 13px;
          color: var(--text-secondary, #888);
          padding: 12px 0;
          text-align: center;
        }
        .rag-file-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 220px;
          overflow-y: auto;
        }
        .rag-file-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.06));
        }
        .rag-file-info {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1;
          color: var(--text-secondary, #888);
        }
        .rag-file-name {
          font-size: 13px;
          color: var(--text-primary, #f1f1f1);
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rag-file-meta {
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin: 0;
        }
        .rag-remove-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 5px;
          border: 1px solid rgba(239,68,68,0.2);
          background: transparent;
          color: #ef4444;
          font-size: 11px;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s;
        }
        .rag-remove-btn:hover { background: rgba(239,68,68,0.1); }
        .rag-clear-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid rgba(239,68,68,0.2);
          background: transparent;
          color: #ef4444;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .rag-clear-confirm {
          background: rgba(239,68,68,0.15);
          border-color: rgba(239,68,68,0.5);
        }
        .rag-search-row {
          display: flex;
          gap: 8px;
        }
        .rag-search-input { flex: 1; }
        .rag-search-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 8px;
          border: none;
          background: rgba(168,85,247,0.15);
          color: #a855f7;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid rgba(168,85,247,0.3);
          transition: all 0.15s;
          flex-shrink: 0;
        }
        .rag-search-btn:hover:not(:disabled) { background: rgba(168,85,247,0.25); }
        .rag-search-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .rag-results-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .rag-result-item {
          padding: 10px 12px;
          border-radius: 8px;
          background: var(--bg-primary, #0d0d17);
          border: 1px solid var(--border-color, rgba(255,255,255,0.06));
        }
        .rag-result-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .rag-result-rank {
          font-size: 11px;
          font-weight: 700;
          color: #f97316;
          width: 20px;
        }
        .rag-result-source {
          font-size: 11px;
          color: #a855f7;
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rag-result-score {
          font-size: 11px;
          font-weight: 600;
          color: #22c55e;
        }
        .rag-result-score-bar {
          height: 3px;
          background: rgba(255,255,255,0.06);
          border-radius: 3px;
          margin-bottom: 8px;
          overflow: hidden;
        }
        .rag-result-score-fill {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #a855f7);
          border-radius: 3px;
          transition: width 0.4s;
        }
        .rag-result-text {
          font-size: 12px;
          color: var(--text-secondary, #888);
          line-height: 1.5;
          margin: 0;
        }
        .rag-search-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-secondary, #888);
          opacity: 0.5;
          text-align: center;
          padding: 32px;
        }
        .rag-search-empty p { margin: 0; font-size: 14px; }
        .rag-search-empty span { font-size: 12px; }
        .rag-info-box {
          padding: 12px 14px;
          border-radius: 10px;
          background: rgba(168,85,247,0.06);
          border: 1px solid rgba(168,85,247,0.12);
          margin-top: auto;
        }
        .rag-info-title {
          font-size: 12px;
          font-weight: 600;
          color: #a855f7;
          margin: 0 0 8px;
        }
        .rag-info-list {
          margin: 0;
          padding-left: 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .rag-info-list li {
          font-size: 11px;
          color: var(--text-secondary, #888);
          line-height: 1.5;
        }
        .rag-spin {
          animation: rag-rotate 1s linear infinite;
        }
        @keyframes rag-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
