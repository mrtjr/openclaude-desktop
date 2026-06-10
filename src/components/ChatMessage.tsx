import { memo } from 'react'
import { User, Play, ChevronDown, Wrench, Terminal, RefreshCw, GitBranch, Trash } from 'lucide-react'
import type { Message } from '../types'
import { formatMarkdown } from '../utils/formatting'
import { extractArtifacts, type Artifact } from '../utils/artifacts'
import { toolCallSummary } from '../utils/toolDisplay'
import { isToolError } from '../utils/toolPolicy'
import CopyButton from './CopyButton'

// One chat message, extracted from the inline map in App.tsx and memoized.
// During streaming, App re-renders on EVERY chunk (chat.streamingText state),
// which used to re-reconcile the entire history — markdown, artifact regexes
// and tool blocks for every past message, per token. With React.memo and
// stable props, past messages bail out and only the streaming bubble updates.
//
// Memo contract (what keeps the shallow compare effective):
//  - `msg` objects are append-only in state — useChat never replaces an
//    inserted message object (mutations happen before insertion).
//  - every callback prop must be identity-stable (App uses useStableCallback).
//  - `collapsedTools` changes identity only on a user toggle (rare) — that
//    re-renders all messages once, which is fine outside the streaming path.

interface ChatMessageProps {
  msg: Message
  language?: string
  showThinking: boolean
  /** Unused in the body on purpose: flips false→true once lazy KaTeX loads,
   *  breaking the memo so raw `$…$` upgrades to typeset math. */
  mathReady: boolean
  /** Keys the user toggled away from their default collapsed state. */
  collapsedTools: Set<string>
  onToggleCollapse: (toolKey: string) => void
  onOpenArtifact: (artifact: Artifact) => void
  onRegenerate: () => void
  onBranch: (msgId: string) => void
  onDelete: (msgId: string) => void
  showToast: (message: string) => void
}

function ChatMessageInner({
  msg, language, showThinking, collapsedTools,
  onToggleCollapse, onOpenArtifact, onRegenerate, onBranch, onDelete, showToast,
}: ChatMessageProps) {
  const artifacts = msg.role === 'assistant' && msg.content ? extractArtifacts(msg.content) : []
  return (
    <div className={`message message-${msg.role}`}>
      <div className="message-avatar">
        {msg.role === 'user' ? <User size={16} /> : <div className="oc-logo">OC</div>}
      </div>
      <div className="message-content">
        {msg.thinking && showThinking && (
          <details className="thinking-block" style={{ margin: '0 0 8px' }}>
            <summary style={{ cursor: 'pointer', opacity: 0.65, fontSize: 12, userSelect: 'none' }}>💭 Raciocínio</summary>
            <div className="thinking-content" style={{ marginTop: 6, padding: '8px 12px', borderLeft: '2px solid rgba(127,127,127,0.3)', opacity: 0.8, fontSize: 13 }} dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.thinking) }} />
          </details>
        )}
        {msg.content && <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />}
        {artifacts.length > 0 && (
          <button
            onClick={() => onOpenArtifact(artifacts[0])}
            title={language === 'pt' ? 'Renderizar o artefato em preview ao vivo' : 'Render the artifact in a live preview'}
            style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(127,127,127,0.3)', background: 'transparent', color: 'inherit', opacity: 0.85 }}
          >
            🎨 {language === 'pt' ? 'Visualizar artefato' : 'Open artifact'}
          </button>
        )}
        {msg.toolCalls && msg.toolCalls.map((tc, i) => {
          const toolKey = `${msg.id}-${i}`
          const resultText = msg.toolResults?.[i]?.result || ''
          const defaultCollapsed = resultText.length > 200
          const isCollapsed = collapsedTools.has(toolKey) ? !defaultCollapsed : defaultCollapsed
          // Header readability (v2.12.52): a run with 10+ execute_commands used
          // to render identical rows — surface the main arg and flag failures
          // (isToolError reuses the audit classification, exec markers included).
          const summary = toolCallSummary(tc.name, tc.arguments)
          const failed = !!resultText && isToolError(resultText, tc.name)
          return (
            <div key={i} className="tool-call">
              <button className="tool-call-header" onClick={() => onToggleCollapse(toolKey)}>
                {isCollapsed ? <Play size={10} className="tool-play" /> : <ChevronDown size={14} />}
                <Wrench size={12} className="tool-icon" /><span>{tc.name}</span>
                {summary && <span className="tool-call-summary" title={summary}>{summary}</span>}
                {failed && <span className="tool-call-badge-error">{language === 'en' ? 'error' : 'erro'}</span>}
              </button>
              {!isCollapsed && (
                <>
                  <pre className="tool-call-args">{JSON.stringify(tc.arguments, null, 2)}</pre>
                  {msg.toolResults?.[i] && (
                    tc.name === 'web_search'
                      // Render search results as markdown so the source
                      // links are clickable (citation-ready format from
                      // electron/web-search-util.js).
                      ? <div className="tool-result tool-result-search" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.toolResults[i].result || '', false) }} />
                      : <div className="tool-result"><Terminal size={12} /><pre>{msg.toolResults[i].result}</pre></div>
                  )}
                </>
              )}
            </div>
          )
        })}
        <div className="message-footer">
          <span className="message-timestamp">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <div className="message-actions">
            {msg.content && <CopyButton text={msg.content} title={language === 'en' ? 'Copy as Markdown' : 'Copiar como Markdown'} onCopied={() => showToast(language === 'en' ? 'Copied as Markdown' : 'Copiado como Markdown')} />}
            {msg.role === 'assistant' && (
              <button
                className="msg-action-btn msg-regen-btn"
                onClick={() => onRegenerate()}
                title={language === 'en' ? 'Regenerate this response' : 'Regenerar esta resposta'}
                aria-label="Regenerate"
              >
                <RefreshCw size={12} />
              </button>
            )}
            <button
              className="msg-action-btn msg-branch-btn"
              onClick={() => onBranch(msg.id)}
              title={language === 'en' ? 'Branch from here' : 'Bifurcar a partir daqui'}
              aria-label="Branch"
            >
              <GitBranch size={12} />
            </button>
            <button className="msg-action-btn" onClick={() => onDelete(msg.id)} title={language === 'en' ? 'Delete message' : 'Excluir mensagem'}><Trash size={12} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

const ChatMessage = memo(ChatMessageInner)
export default ChatMessage
