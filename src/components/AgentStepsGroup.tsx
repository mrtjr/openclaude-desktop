import { memo, useMemo } from 'react'
import { ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react'
import type { Message } from '../types'
import { formatMarkdown } from '../utils/formatting'
import { isToolError } from '../utils/toolPolicy'
import { summarizeSteps } from '../utils/messageGroups'
import ToolCallBlock from './ToolCallBlock'

// Compact, collapsible block for a run of consecutive agent tool-step
// messages (v2.12.71). The digest shows ~12 execute_commands per agent turn —
// each used to render as a FULL message (30px avatar, footer, 3 action
// buttons), turning every agent session into a wall of noise. Grouped, the
// turn reads as one line ("12 passos · execute_command ×9 …") that expands
// into the familiar ToolCallBlocks plus the agent's short narration between
// steps. While the turn is live the group stays open so progress is visible;
// when it ends it collapses to the summary line.

interface AgentStepsGroupProps {
  msgs: Message[]
  /** Stable group identity (first message id) — handed back to
   *  onToggleExpanded so App can pass one identity-stable callback
   *  for every group (memo contract, same as onToggleCollapse). */
  groupKey: string
  language?: string
  /** True while this group is the in-flight tail of a running turn. */
  live: boolean
  expanded: boolean
  onToggleExpanded: (key: string) => void
  /** Unused in the body on purpose (same contract as ChatMessage): flips
   *  false→true once lazy KaTeX loads, breaking the memo so raw `$…$` in
   *  narration upgrades to typeset math. */
  mathReady: boolean
  showThinking: boolean
  collapsedTools: Set<string>
  onToggleCollapse: (toolKey: string) => void
}

function AgentStepsGroupInner({
  msgs, groupKey, language, live, expanded, onToggleExpanded,
  showThinking, collapsedTools, onToggleCollapse,
}: AgentStepsGroupProps) {
  const summary = useMemo(() => summarizeSteps(msgs, isToolError), [msgs])
  const en = language === 'en'
  const countsLabel = summary.counts
    .slice(0, 3)
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(' · ')
  return (
    <div className={`agent-steps-group ${live ? 'live' : ''}`}>
      <button
        className="agent-steps-header"
        onClick={() => onToggleExpanded(groupKey)}
        aria-expanded={expanded}
        title={expanded ? (en ? 'Collapse steps' : 'Recolher passos') : (en ? 'Expand steps' : 'Expandir passos')}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {live ? <Loader2 size={12} className="spin" /> : <Wrench size={12} />}
        <span className="agent-steps-title">
          {summary.total} {en ? (summary.total === 1 ? 'agent step' : 'agent steps') : (summary.total === 1 ? 'passo de agente' : 'passos de agente')}
        </span>
        {countsLabel && <span className="agent-steps-counts" title={countsLabel}>{countsLabel}</span>}
        {summary.errors > 0 && (
          <span className="tool-call-badge-error">
            {summary.errors} {en ? (summary.errors === 1 ? 'error' : 'errors') : (summary.errors === 1 ? 'erro' : 'erros')}
          </span>
        )}
      </button>
      {expanded && (
        <div className="agent-steps-body">
          {msgs.map(m => (
            <div key={m.id} className="agent-step">
              {m.thinking && showThinking && (
                <details className="thinking-block agent-step-thinking">
                  <summary>💭 {en ? 'Reasoning' : 'Raciocínio'}</summary>
                  <div className="thinking-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(m.thinking) }} />
                </details>
              )}
              {m.content && (
                <div className="agent-step-narration" dangerouslySetInnerHTML={{ __html: formatMarkdown(m.content) }} />
              )}
              {m.toolCalls?.map((tc, i) => (
                <ToolCallBlock
                  key={i}
                  tc={tc}
                  result={m.toolResults?.[i]}
                  toolKey={`${m.id}-${i}`}
                  language={language}
                  collapsedTools={collapsedTools}
                  onToggleCollapse={onToggleCollapse}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const AgentStepsGroup = memo(AgentStepsGroupInner)
export default AgentStepsGroup
