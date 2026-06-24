import { memo, useState } from 'react'
import { User, RefreshCw, GitBranch, Trash, Pencil, Check, CornerDownRight } from 'lucide-react'
import type { Message } from '../types'
import { formatMarkdown } from '../utils/formatting'
import { applyDisplayTransforms, type DisplayTransform } from '../utils/outputHooks'
import { logInsight } from '../services/devInsights'
import { extractArtifacts, type Artifact } from '../utils/artifacts'
import { canEditMessage } from '../utils/conversationEdit'
import CopyButton from './CopyButton'
import ToolCallBlock from './ToolCallBlock'

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
  /** v2.129.0 — edit a user message in place and re-run the conversation
   *  from that point (ChatGPT-style). Optional: when absent, the pencil is
   *  hidden. Must be identity-stable (App uses useStableCallback). */
  onEditResend?: (msgId: string, newText: string) => void
  /** v2.130.0 — resume a response that the provider cut off at the token
   *  limit (ChatGPT "Continue generating"). Shown only when msg.truncated. */
  onContinue?: (msgId: string) => void
  /** v2.133.0 — click a model-suggested follow-up question (Perplexity-style
   *  chips). Sends it as a new message. */
  onFollowup?: (text: string) => void
  showToast: (message: string) => void
  /** v2.94.0 — transformações de exibição (MessageDisplay): aplicadas ao texto
   *  do assistente antes de renderizar. Identidade estável (memoizado no App). */
  displayTransforms?: DisplayTransform[]
}

function ChatMessageInner({
  msg, language, showThinking, collapsedTools,
  onToggleCollapse, onOpenArtifact, onRegenerate, onBranch, onDelete, onEditResend, onContinue, onFollowup, showToast, displayTransforms,
}: ChatMessageProps) {
  const en = language === 'en'
  // In-place edit state (ChatGPT-style). Local so toggling it never touches
  // the App/memo contract — past bubbles still bail out during streaming.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editable = !!onEditResend && canEditMessage(msg)
  const beginEdit = () => { setDraft(msg.content); setEditing(true) }
  const commitEdit = () => { setEditing(false); onEditResend?.(msg.id, draft) }
  const cancelEdit = () => { setEditing(false) }

  const artifacts = msg.role === 'assistant' && msg.content ? extractArtifacts(msg.content) : []
  // Só transforma a exibição do ASSISTENTE (mensagens do usuário ficam intactas).
  const displayContent = msg.role === 'assistant' && displayTransforms?.length
    ? applyDisplayTransforms(msg.content, displayTransforms) : msg.content
  return (
    <div className={`message message-${msg.role}`} data-mid={msg.id}>
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
        {editing ? (
          <div className="message-edit">
            <textarea
              className="message-edit-area"
              value={draft}
              autoFocus
              rows={Math.min(10, Math.max(2, draft.split('\n').length))}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit() }
                else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
              }}
              aria-label={en ? 'Edit message' : 'Editar mensagem'}
            />
            <div className="message-edit-actions">
              <button className="message-edit-cancel" onClick={cancelEdit}>{en ? 'Cancel' : 'Cancelar'}</button>
              <button className="message-edit-save" onClick={commitEdit} title={en ? 'Save & resend (Ctrl+Enter)' : 'Salvar e reenviar (Ctrl+Enter)'}>
                <Check size={12} /> {en ? 'Save & resend' : 'Salvar e reenviar'}
              </button>
            </div>
          </div>
        ) : (
          msg.content && <div className="message-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(displayContent) }} />
        )}
        {artifacts.length > 0 && (
          <button
            onClick={() => onOpenArtifact(artifacts[0])}
            title={language === 'pt' ? 'Renderizar o artefato em preview ao vivo' : 'Render the artifact in a live preview'}
            style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(127,127,127,0.3)', background: 'transparent', color: 'inherit', opacity: 0.85 }}
          >
            🎨 {language === 'pt' ? 'Visualizar artefato' : 'Open artifact'}
          </button>
        )}
        {!editing && msg.role === 'assistant' && msg.truncated && onContinue && (
          <div className="truncated-row">
            <span className="truncated-hint" title={en ? 'The provider stopped at the token limit' : 'O provedor parou no limite de tokens'}>
              {en ? 'Response cut off at the token limit' : 'Resposta cortada no limite de tokens'}
            </span>
            <button className="continue-gen-btn" onClick={() => onContinue(msg.id)} title={en ? 'Continue generating from where it stopped' : 'Continuar gerando de onde parou'}>
              <CornerDownRight size={12} /> {en ? 'Continue generating' : 'Continuar gerando'}
            </button>
          </div>
        )}
        {msg.toolCalls && msg.toolCalls.map((tc, i) => (
          <ToolCallBlock
            key={i}
            tc={tc}
            result={msg.toolResults?.[i]}
            toolKey={`${msg.id}-${i}`}
            language={language}
            collapsedTools={collapsedTools}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
        {!editing && (
        <div className="message-footer">
          <span className="message-timestamp">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <div className="message-actions">
            {msg.content && <CopyButton text={msg.content} title={language === 'en' ? 'Copy as Markdown' : 'Copiar como Markdown'} onCopied={() => { if (msg.role === 'assistant') logInsight('chat', 'copy'); showToast(language === 'en' ? 'Copied as Markdown' : 'Copiado como Markdown') }} />}
            {editable && (
              <button
                className="msg-action-btn msg-edit-btn"
                onClick={beginEdit}
                title={en ? 'Edit & resend' : 'Editar e reenviar'}
                aria-label={en ? 'Edit message' : 'Editar mensagem'}
              >
                <Pencil size={12} />
              </button>
            )}
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
            <button className="msg-action-btn" onClick={() => onDelete(msg.id)} title={language === 'en' ? 'Delete message' : 'Excluir mensagem'} aria-label={language === 'en' ? 'Delete message' : 'Excluir mensagem'}><Trash size={12} /></button>
          </div>
        </div>
        )}
        {/* Perguntas de acompanhamento sugeridas pelo modelo (chips estilo
            Perplexity, v2.133.0). Clicar envia como nova mensagem. */}
        {!editing && msg.role === 'assistant' && msg.followups && msg.followups.length > 0 && onFollowup && (
          <div className="followups">
            <div className="followups-label">{en ? 'Related' : 'Perguntas relacionadas'}</div>
            {msg.followups.map((q, i) => (
              <button key={i} className="followup-chip" onClick={() => onFollowup(q)} title={q}>
                <span className="followup-q">{q}</span>
                <CornerDownRight size={12} className="followup-arrow" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const ChatMessage = memo(ChatMessageInner)
export default ChatMessage
