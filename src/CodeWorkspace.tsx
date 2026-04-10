import { useState, useCallback, useRef } from 'react'
import {
  X, FolderOpen, ChevronRight, ChevronDown as ChevronDownIcon,
  File, Folder, Check, XCircle, Loader2, MessageSquare,
  Code2, FileCode, Wand2, AlertTriangle, Send
} from 'lucide-react'
import { AppSettings } from './Settings'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export interface DiffHunk {
  id: string
  filePath: string
  originalContent: string
  newContent: string
  description: string
  accepted: boolean | null
  lineFrom: number
  lineTo: number
}

interface CodeWorkspaceProps {
  settings: AppSettings
  ollamaModels: string[]
  onClose: () => void
  onInsertToChat: (text: string) => void
}

// ── File extension icons ───────────────────────────────────────────────────────

const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f0db4f', jsx: '#61dafb',
  py: '#3572a5', rs: '#dea584', go: '#00add8', css: '#563d7c',
  scss: '#c6538c', html: '#e34c26', json: '#f0db4f', md: '#083fa1',
  sh: '#89e051', bash: '#89e051', yml: '#cb171e', yaml: '#cb171e',
  toml: '#9c4221', sql: '#336791', graphql: '#e535ab', vue: '#42b883',
  svelte: '#ff3e00', kt: '#a97bff', java: '#b07219', c: '#555555',
  cpp: '#f34b7d', h: '#555555', cs: '#178600', rb: '#701516',
  php: '#4f5d95', swift: '#ffac45', dart: '#00b4ab',
}

function getExtColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? '#888'
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ── Diff parsing ───────────────────────────────────────────────────────────────

interface ParsedDiff {
  description: string
  hunks: { lineFrom: number; lineTo: number; removed: string[]; added: string[] }[]
}

function parseDiffBlock(diffText: string): ParsedDiff {
  const lines = diffText.split('\n')
  const hunks: ParsedDiff['hunks'] = []
  let current: ParsedDiff['hunks'][0] | null = null

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current)
      // Parse @@ -from,count +to,count @@
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      const lineFrom = m ? parseInt(m[1]) : 1
      const lineTo = m ? parseInt(m[2]) : 1
      current = { lineFrom, lineTo, removed: [], added: [] }
    } else if (current) {
      if (line.startsWith('-') && !line.startsWith('---')) {
        current.removed.push(line.slice(1))
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        current.added.push(line.slice(1))
      }
    }
  }
  if (current) hunks.push(current)
  return { description: '', hunks }
}

function extractDiffBlocks(text: string): string[] {
  const blocks: string[] = []
  const regex = /```diff\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1])
  }
  return blocks
}

// ── Apply a hunk to file content ───────────────────────────────────────────────

function applyHunk(content: string, hunk: DiffHunk): string {
  const lines = content.split('\n')
  const parsed = parseDiffBlock(
    `@@ -${hunk.lineFrom},${hunk.originalContent.split('\n').length} +${hunk.lineFrom},${hunk.newContent.split('\n').length} @@\n` +
    hunk.originalContent.split('\n').map(l => `-${l}`).join('\n') + '\n' +
    hunk.newContent.split('\n').map(l => `+${l}`).join('\n')
  )

  if (parsed.hunks.length === 0) {
    // Fallback: simple replace original with new in full content
    if (hunk.originalContent && content.includes(hunk.originalContent)) {
      return content.replace(hunk.originalContent, hunk.newContent)
    }
    return content
  }

  const h = parsed.hunks[0]
  const from = Math.max(0, h.lineFrom - 1)
  const removeCount = h.removed.length

  const before = lines.slice(0, from)
  const after = lines.slice(from + removeCount)
  const result = [...before, ...h.added, ...after]
  return result.join('\n')
}

// ── Mini Diff View ─────────────────────────────────────────────────────────────

function MiniDiff({ original, updated }: { original: string; updated: string }) {
  const origLines = original.split('\n')
  const newLines = updated.split('\n')
  return (
    <div className="workspace-minidiff">
      {origLines.map((l, i) => (
        <div key={`r${i}`} className="workspace-diff-line workspace-diff-removed">
          <span className="workspace-diff-gutter">-</span>
          <span>{l}</span>
        </div>
      ))}
      {newLines.map((l, i) => (
        <div key={`a${i}`} className="workspace-diff-line workspace-diff-added">
          <span className="workspace-diff-gutter">+</span>
          <span>{l}</span>
        </div>
      ))}
    </div>
  )
}

// ── Tree Item (recursive) ──────────────────────────────────────────────────────

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelectFile,
}: {
  node: TreeNode
  depth: number
  selectedPath: string | null
  onSelectFile: (path: string, name: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const isSelected = node.path === selectedPath

  if (node.type === 'dir') {
    return (
      <div>
        <div
          className="workspace-tree-item workspace-tree-dir"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRight size={12} />}
          <Folder size={13} style={{ color: '#f0db4f', flexShrink: 0 }} />
          <span className="workspace-tree-name">{node.name}</span>
        </div>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`workspace-tree-item workspace-tree-file ${isSelected ? 'workspace-tree-selected' : ''}`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => onSelectFile(node.path, node.name)}
      title={node.path}
    >
      <File size={12} style={{ color: getExtColor(node.name), flexShrink: 0 }} />
      <span className="workspace-tree-name">{node.name}</span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CodeWorkspace({
  settings,
  ollamaModels: _ollamaModels,
  onClose,
  onInsertToChat,
}: CodeWorkspaceProps) {
  // File tree
  const [tree, setTree] = useState<TreeNode[]>([])
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)

  // Editor
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string>('')
  const [fileContent, setFileContent] = useState<string>('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)

  // AI panel
  const [instruction, setInstruction] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [hunks, setHunks] = useState<DiffHunk[]>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Open folder ──────────────────────────────────────────────────────────────

  const handleOpenFolder = async () => {
    setTreeError(null)
    setLoadingTree(true)
    try {
      // Use PowerShell folder picker on Windows
      const cmd =
        'powershell -command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowDialog() | Out-Null; $f.SelectedPath"'
      const { stdout, error } = await window.electron.execCommand(cmd)
      if (error && !stdout) {
        setTreeError(`Erro ao abrir pasta: ${error}`)
        setLoadingTree(false)
        return
      }
      const dirPath = stdout.trim()
      if (!dirPath) {
        setLoadingTree(false)
        return
      }
      const { tree: nodes, error: treeErr } = await window.electron.workspaceTree(dirPath)
      if (treeErr) {
        setTreeError(treeErr)
      } else {
        setTree(nodes ?? [])
        setRootPath(dirPath)
      }
    } catch (e: any) {
      setTreeError(e.message ?? String(e))
    } finally {
      setLoadingTree(false)
    }
  }

  // ── Select file ───────────────────────────────────────────────────────────────

  const handleSelectFile = useCallback(async (path: string, name: string) => {
    if (selectedFile === path) return
    setSelectedFile(path)
    setSelectedFileName(name)
    setFileError(null)
    setLoadingFile(true)
    setFileContent('')
    try {
      const { content, error } = await window.electron.readFile(path)
      if (error) {
        setFileError(error)
      } else {
        setFileContent(content ?? '')
      }
    } catch (e: any) {
      setFileError(e.message ?? String(e))
    } finally {
      setLoadingFile(false)
    }
  }, [selectedFile])

  // ── Generate AI diff ──────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!instruction.trim() || !selectedFile || !fileContent || generating) return
    setGenerating(true)
    setGenError(null)

    const prompt = `You are a code editor assistant. The user wants to make the following change to the file \`${selectedFileName}\`:

INSTRUCTION: ${instruction}

CURRENT FILE CONTENT:
\`\`\`
${fileContent}
\`\`\`

Respond with ONLY a unified diff in a \`\`\`diff\`\`\` code block. Do NOT include explanations outside the diff block. The diff must use standard unified diff format with @@ ... @@ hunk headers. Use --- a/${selectedFileName} and +++ b/${selectedFileName} headers.`

    try {
      const apiKey = (() => {
        switch (settings.provider) {
          case 'openai': return settings.openaiApiKey
          case 'gemini': return settings.geminiApiKey
          case 'anthropic': return settings.anthropicApiKey
          case 'openrouter': return settings.openrouterApiKey
          case 'modal': return settings.modalApiKey
          default: return ''
        }
      })()
      const model = (() => {
        switch (settings.provider) {
          case 'openai': return settings.openaiModel
          case 'gemini': return settings.geminiModel
          case 'anthropic': return settings.anthropicModel
          case 'openrouter': return settings.openrouterModel
          case 'modal': return settings.modalModel
          default: return ''
        }
      })()

      const res = await window.electron.providerChat({
        provider: settings.provider,
        apiKey,
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 4096,
        modalHostname: settings.modalHostname,
      })

      const text: string =
        res?.choices?.[0]?.message?.content ??
        res?.content?.[0]?.text ??
        res?.candidates?.[0]?.content?.parts?.[0]?.text ??
        ''

      const diffBlocks = extractDiffBlocks(text)
      if (diffBlocks.length === 0) {
        setGenError('O modelo não retornou um bloco diff. Tente reformular a instrução.')
        setGenerating(false)
        return
      }

      const newHunks: DiffHunk[] = []
      for (const block of diffBlocks) {
        const parsed = parseDiffBlock(block)
        for (const h of parsed.hunks) {
          if (h.removed.length === 0 && h.added.length === 0) continue
          newHunks.push({
            id: generateId(),
            filePath: selectedFile,
            originalContent: h.removed.join('\n'),
            newContent: h.added.join('\n'),
            description: instruction,
            accepted: null,
            lineFrom: h.lineFrom,
            lineTo: h.lineTo,
          })
        }
      }

      if (newHunks.length === 0) {
        setGenError('Nenhuma alteração detectada no diff gerado.')
      } else {
        setHunks((prev) => [...prev, ...newHunks])
        setInstruction('')
      }
    } catch (e: any) {
      setGenError(e.message ?? String(e))
    } finally {
      setGenerating(false)
    }
  }

  // ── Accept hunk ───────────────────────────────────────────────────────────────

  const handleAccept = async (hunkId: string) => {
    const hunk = hunks.find((h) => h.id === hunkId)
    if (!hunk || hunk.accepted !== null) return

    // Apply to file content
    const updatedContent = applyHunk(fileContent, hunk)
    setFileContent(updatedContent)

    // Write to disk
    setSaving(true)
    try {
      await window.electron.writeFile({ filePath: hunk.filePath, content: updatedContent })
    } catch {}
    setSaving(false)

    setHunks((prev) => prev.map((h) => h.id === hunkId ? { ...h, accepted: true } : h))
    // Remove accepted hunks after a short delay for feedback
    setTimeout(() => {
      setHunks((prev) => prev.filter((h) => h.id !== hunkId))
    }, 1200)
  }

  // ── Reject hunk ───────────────────────────────────────────────────────────────

  const handleReject = (hunkId: string) => {
    setHunks((prev) => prev.map((h) => h.id === hunkId ? { ...h, accepted: false } : h))
    setTimeout(() => {
      setHunks((prev) => prev.filter((h) => h.id !== hunkId))
    }, 600)
  }

  // ── Line numbers & highlight ──────────────────────────────────────────────────

  const pendingHunks = hunks.filter((h) => h.accepted === null && h.filePath === selectedFile)
  const pendingLineSet = new Set<number>()
  for (const h of pendingHunks) {
    for (let i = h.lineFrom; i <= h.lineTo; i++) pendingLineSet.add(i)
  }

  const contentLines = fileContent.split('\n')

  // ── Insert to chat ────────────────────────────────────────────────────────────

  const handleInsert = () => {
    if (!selectedFile || !fileContent) return
    onInsertToChat(`\`\`\`${selectedFileName.split('.').pop() ?? 'txt'}\n${fileContent}\n\`\`\``)
  }

  return (
    <>
      <style>{WORKSPACE_CSS}</style>
      <div className="workspace-overlay">
        <div className="workspace-modal">
          {/* Header */}
          <div className="workspace-header">
            <div className="workspace-header-left">
              <Code2 size={16} className="workspace-header-icon" />
              <span className="workspace-title">Code Workspace</span>
              {selectedFileName && (
                <span className="workspace-file-badge">
                  <FileCode size={12} />
                  {selectedFileName}
                  {saving && <Loader2 size={10} className="workspace-spin" />}
                </span>
              )}
            </div>
            <div className="workspace-header-right">
              {selectedFile && (
                <button className="workspace-btn-ghost" onClick={handleInsert} title="Inserir arquivo no chat">
                  <MessageSquare size={13} />
                  <span>Inserir no Chat</span>
                </button>
              )}
              <button className="workspace-icon-btn" onClick={onClose}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Three panels */}
          <div className="workspace-body">
            {/* Left: File tree */}
            <div className="workspace-panel-tree">
              <div className="workspace-panel-header">
                <span>Arquivos</span>
                <button
                  className="workspace-btn-ghost workspace-open-btn"
                  onClick={handleOpenFolder}
                  disabled={loadingTree}
                  title="Abrir pasta"
                >
                  {loadingTree ? <Loader2 size={12} className="workspace-spin" /> : <FolderOpen size={12} />}
                  <span>Abrir Pasta</span>
                </button>
              </div>
              <div className="workspace-tree-scroll">
                {treeError && (
                  <div className="workspace-tree-error">
                    <AlertTriangle size={13} />
                    <span>{treeError}</span>
                  </div>
                )}
                {!rootPath && !treeError && !loadingTree && (
                  <div className="workspace-tree-empty">
                    <FolderOpen size={28} style={{ opacity: 0.3 }} />
                    <span>Abra uma pasta para começar</span>
                  </div>
                )}
                {rootPath && (
                  <div className="workspace-tree-root">
                    <div className="workspace-tree-root-label">
                      <Folder size={12} style={{ color: '#f0db4f' }} />
                      <span>{rootPath.split(/[\\/]/).pop()}</span>
                    </div>
                    {tree.map((node) => (
                      <TreeItem
                        key={node.path}
                        node={node}
                        depth={0}
                        selectedPath={selectedFile}
                        onSelectFile={handleSelectFile}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Center: Editor */}
            <div className="workspace-panel-editor">
              {!selectedFile && (
                <div className="workspace-editor-empty">
                  <Code2 size={36} style={{ opacity: 0.2 }} />
                  <span>Selecione um arquivo para editar</span>
                </div>
              )}
              {selectedFile && loadingFile && (
                <div className="workspace-editor-loading">
                  <Loader2 size={20} className="workspace-spin" />
                  <span>Carregando arquivo...</span>
                </div>
              )}
              {selectedFile && fileError && (
                <div className="workspace-editor-error">
                  <AlertTriangle size={16} />
                  <span>{fileError}</span>
                </div>
              )}
              {selectedFile && !loadingFile && !fileError && (
                <>
                  <div className="workspace-editor-scroll">
                    <pre className="workspace-editor-pre">
                      {contentLines.map((line, i) => {
                        const lineNum = i + 1
                        const highlighted = pendingLineSet.has(lineNum)
                        return (
                          <div
                            key={i}
                            className={`workspace-editor-line ${highlighted ? 'workspace-editor-line-highlight' : ''}`}
                          >
                            <span className="workspace-line-num">{lineNum}</span>
                            <span className="workspace-line-content">{line || ' '}</span>
                          </div>
                        )
                      })}
                    </pre>
                  </div>

                  {/* AI instruction input */}
                  <div className="workspace-ask-area">
                    <div className="workspace-ask-label">
                      <Wand2 size={13} />
                      <span>Pedir ao AI</span>
                    </div>
                    <div className="workspace-ask-row">
                      <textarea
                        ref={textareaRef}
                        className="workspace-ask-input"
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="Descreva a mudança que deseja fazer neste arquivo..."
                        rows={2}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault()
                            handleGenerate()
                          }
                        }}
                      />
                      <button
                        className="workspace-gen-btn"
                        onClick={handleGenerate}
                        disabled={generating || !instruction.trim()}
                        title="Gerar diff (Ctrl+Enter)"
                      >
                        {generating ? (
                          <Loader2 size={16} className="workspace-spin" />
                        ) : (
                          <Send size={16} />
                        )}
                      </button>
                    </div>
                    {genError && (
                      <div className="workspace-gen-error">
                        <AlertTriangle size={12} />
                        {genError}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Right: AI suggestions */}
            <div className="workspace-panel-suggestions">
              <div className="workspace-panel-header">
                <span>Sugestões AI</span>
                {hunks.length > 0 && (
                  <span className="workspace-suggestion-count">{hunks.filter(h => h.accepted === null).length}</span>
                )}
              </div>
              <div className="workspace-suggestions-scroll">
                {hunks.length === 0 && (
                  <div className="workspace-suggestions-empty">
                    <Wand2 size={28} style={{ opacity: 0.25 }} />
                    <span>As sugestões do AI aparecerão aqui</span>
                  </div>
                )}
                {hunks.map((hunk) => (
                  <div
                    key={hunk.id}
                    className={`workspace-hunk-card ${
                      hunk.accepted === true
                        ? 'workspace-hunk-accepted'
                        : hunk.accepted === false
                        ? 'workspace-hunk-rejected'
                        : ''
                    }`}
                  >
                    <div className="workspace-hunk-header">
                      <div className="workspace-hunk-desc">{hunk.description}</div>
                      <div className="workspace-hunk-meta">
                        <span className="workspace-hunk-file" title={hunk.filePath}>
                          {hunk.filePath.split(/[\\/]/).pop()}
                        </span>
                        <span className="workspace-hunk-lines">
                          L{hunk.lineFrom}–{hunk.lineTo}
                        </span>
                      </div>
                    </div>

                    <MiniDiff
                      original={hunk.originalContent}
                      updated={hunk.newContent}
                    />

                    {hunk.accepted === null && (
                      <div className="workspace-hunk-actions">
                        <button
                          className="workspace-hunk-accept"
                          onClick={() => handleAccept(hunk.id)}
                        >
                          <Check size={13} />
                          Aceitar
                        </button>
                        <button
                          className="workspace-hunk-reject"
                          onClick={() => handleReject(hunk.id)}
                        >
                          <XCircle size={13} />
                          Rejeitar
                        </button>
                      </div>
                    )}
                    {hunk.accepted === true && (
                      <div className="workspace-hunk-status workspace-hunk-status-ok">
                        <Check size={12} /> Aceito
                      </div>
                    )}
                    {hunk.accepted === false && (
                      <div className="workspace-hunk-status workspace-hunk-status-rejected">
                        <XCircle size={12} /> Rejeitado
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const WORKSPACE_CSS = `
.workspace-overlay {
  position: fixed;
  inset: 0;
  top: 32px; /* titlebar height */
  background: var(--bg-primary, #0d0d17);
  display: flex;
  flex-direction: column;
  z-index: 900;
}

.workspace-modal {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  flex-shrink: 0;
  background: var(--bg-secondary, #13131f);
}

.workspace-header-left { display: flex; align-items: center; gap: 10px; }
.workspace-header-right { display: flex; align-items: center; gap: 8px; }
.workspace-header-icon { color: #60a5fa; }
.workspace-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary, #f1f1f1);
}

.workspace-file-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(96,165,250,0.1);
  border: 1px solid rgba(96,165,250,0.2);
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 0.75rem;
  color: #60a5fa;
}

.workspace-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* Left panel: file tree */
.workspace-panel-tree {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary, #13131f);
}

/* Center panel: editor */
.workspace-panel-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary, #0d0d17);
}

/* Right panel: suggestions */
.workspace-panel-suggestions {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color, rgba(255,255,255,0.08));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary, #13131f);
}

.workspace-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.workspace-open-btn {
  font-size: 0.72rem !important;
  padding: 3px 8px !important;
}

/* Tree */
.workspace-tree-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.workspace-tree-root-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.workspace-tree-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  font-size: 0.8rem;
  color: var(--text-primary, #f1f1f1);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  transition: background 0.1s;
}
.workspace-tree-item:hover { background: rgba(255,255,255,0.05); }
.workspace-tree-dir { color: var(--text-secondary, #888); }
.workspace-tree-dir:hover { color: var(--text-primary, #f1f1f1); }
.workspace-tree-selected { background: rgba(96,165,250,0.1) !important; color: #60a5fa !important; }
.workspace-tree-name { overflow: hidden; text-overflow: ellipsis; }

.workspace-tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 200px;
  color: var(--text-secondary, #888);
  font-size: 0.78rem;
  text-align: center;
  padding: 20px;
}

.workspace-tree-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 10px;
  padding: 8px;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.2);
  border-radius: 6px;
  color: #ef4444;
  font-size: 0.75rem;
  word-break: break-word;
}

/* Editor */
.workspace-editor-empty,
.workspace-editor-loading,
.workspace-editor-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  color: var(--text-secondary, #888);
  font-size: 0.85rem;
}
.workspace-editor-error { color: #ef4444; }

.workspace-editor-scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.workspace-editor-pre {
  margin: 0;
  padding: 0;
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.8rem;
  line-height: 1.6;
  white-space: pre;
  color: var(--text-primary, #f1f1f1);
  min-width: max-content;
}

.workspace-editor-line {
  display: flex;
  align-items: stretch;
  min-height: 1.6em;
}
.workspace-editor-line-highlight {
  background: rgba(250,204,21,0.08) !important;
  outline: 1px solid rgba(250,204,21,0.2);
}
.workspace-editor-line:hover { background: rgba(255,255,255,0.03); }

.workspace-line-num {
  display: inline-block;
  min-width: 44px;
  padding: 0 10px 0 8px;
  color: var(--text-secondary, #888);
  opacity: 0.45;
  user-select: none;
  text-align: right;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
  margin-right: 12px;
}

.workspace-line-content {
  white-space: pre;
  flex: 1;
}

/* AI ask area */
.workspace-ask-area {
  border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));
  padding: 10px 14px;
  flex-shrink: 0;
  background: var(--bg-secondary, #13131f);
}

.workspace-ask-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.workspace-ask-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.workspace-ask-input {
  flex: 1;
  background: var(--bg-primary, #0d0d17);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 7px;
  color: var(--text-primary, #f1f1f1);
  font-size: 0.82rem;
  padding: 8px 10px;
  resize: none;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.workspace-ask-input:focus { border-color: rgba(96,165,250,0.4); }
.workspace-ask-input::placeholder { color: var(--text-secondary, #888); }

.workspace-gen-btn {
  background: #3b82f6;
  border: none;
  border-radius: 7px;
  color: #fff;
  cursor: pointer;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}
.workspace-gen-btn:hover:not(:disabled) { background: #2563eb; }
.workspace-gen-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.workspace-gen-error {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  color: #ef4444;
  font-size: 0.75rem;
}

/* Suggestions */
.workspace-suggestions-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workspace-suggestions-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 200px;
  color: var(--text-secondary, #888);
  font-size: 0.78rem;
  text-align: center;
}

.workspace-suggestion-count {
  background: rgba(96,165,250,0.15);
  color: #60a5fa;
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 0.7rem;
  font-weight: 700;
}

.workspace-hunk-card {
  background: var(--bg-primary, #0d0d17);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 8px;
  overflow: hidden;
  transition: opacity 0.3s;
}
.workspace-hunk-accepted { border-color: rgba(34,197,94,0.3); }
.workspace-hunk-rejected { opacity: 0.45; }

.workspace-hunk-header {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
}
.workspace-hunk-desc {
  font-size: 0.78rem;
  color: var(--text-primary, #f1f1f1);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-hunk-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.workspace-hunk-file {
  font-size: 0.7rem;
  color: #60a5fa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}
.workspace-hunk-lines {
  font-size: 0.68rem;
  color: var(--text-secondary, #888);
  white-space: nowrap;
}

/* Mini diff */
.workspace-minidiff {
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.72rem;
  overflow-x: auto;
  max-height: 160px;
  overflow-y: auto;
}

.workspace-diff-line {
  display: flex;
  align-items: flex-start;
  padding: 1px 8px;
  white-space: pre;
  line-height: 1.5;
}
.workspace-diff-removed {
  background: rgba(239,68,68,0.15);
  color: #ef4444;
}
.workspace-diff-added {
  background: rgba(34,197,94,0.15);
  color: #22c55e;
}
.workspace-diff-gutter {
  min-width: 14px;
  font-weight: 700;
  margin-right: 6px;
  flex-shrink: 0;
  user-select: none;
}

.workspace-hunk-actions {
  display: flex;
  gap: 6px;
  padding: 7px 8px;
  border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));
}

.workspace-hunk-accept {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.3);
  border-radius: 5px;
  color: #22c55e;
  cursor: pointer;
  padding: 5px;
  font-size: 0.75rem;
  font-weight: 500;
  transition: all 0.15s;
}
.workspace-hunk-accept:hover {
  background: rgba(34,197,94,0.2);
  border-color: #22c55e;
}

.workspace-hunk-reject {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.25);
  border-radius: 5px;
  color: #ef4444;
  cursor: pointer;
  padding: 5px;
  font-size: 0.75rem;
  font-weight: 500;
  transition: all 0.15s;
}
.workspace-hunk-reject:hover {
  background: rgba(239,68,68,0.18);
  border-color: #ef4444;
}

.workspace-hunk-status {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  font-size: 0.72rem;
  border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));
}
.workspace-hunk-status-ok { color: #22c55e; }
.workspace-hunk-status-rejected { color: var(--text-secondary, #888); }

/* Shared */
.workspace-btn-ghost {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 5px;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 4px 10px;
  font-size: 0.78rem;
  transition: all 0.15s;
}
.workspace-btn-ghost:hover:not(:disabled) { color: var(--text-primary, #f1f1f1); border-color: rgba(255,255,255,0.2); }
.workspace-btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }

.workspace-icon-btn {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}
.workspace-icon-btn:hover { color: var(--text-primary, #f1f1f1); background: rgba(255,255,255,0.06); }

.workspace-spin {
  animation: workspace-spin 0.7s linear infinite;
}
@keyframes workspace-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`
