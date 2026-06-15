import { memo } from 'react'
import { Play, ChevronDown, Wrench, Terminal } from 'lucide-react'
import type { ToolCall, ToolResult } from '../types'
import { formatMarkdown } from '../utils/formatting'
import { toolCallSummary } from '../utils/toolDisplay'
import { isToolError } from '../utils/toolPolicy'

// One tool call + its result, with the collapse/expand header. Extracted from
// ChatMessage (v2.12.71) so the new AgentStepsGroup renders the exact same
// block — same classes, same collapse semantics, no visual fork.
//
// memo (v2.48.0): numa rodada agêntica longa (a telemetria mostra 452
// execute_command), cada novo passo recriava o array de msgs do grupo ao vivo e
// re-renderizava TODOS os blocos — re-parseando o markdown de cada resultado
// (O(n²)). Memoizado + markdown cacheado, só o bloco novo renderiza.

interface ToolCallBlockProps {
  tc: ToolCall
  result?: ToolResult
  toolKey: string
  language?: string
  /** Keys the user toggled away from their default collapsed state. */
  collapsedTools: Set<string>
  onToggleCollapse: (toolKey: string) => void
}

function ToolCallBlockInner({
  tc, result, toolKey, language, collapsedTools, onToggleCollapse,
}: ToolCallBlockProps) {
  const resultText = result?.result || ''
  const defaultCollapsed = resultText.length > 200
  const isCollapsed = collapsedTools.has(toolKey) ? !defaultCollapsed : defaultCollapsed
  // Header readability (v2.12.52): a run with 10+ execute_commands used
  // to render identical rows — surface the main arg and flag failures
  // (isToolError reuses the audit classification, exec markers included).
  const summary = toolCallSummary(tc.name, tc.arguments)
  const failed = !!resultText && isToolError(resultText, tc.name)
  return (
    <div className="tool-call">
      <button className="tool-call-header" onClick={() => onToggleCollapse(toolKey)}>
        {isCollapsed ? <Play size={10} className="tool-play" /> : <ChevronDown size={14} />}
        <Wrench size={12} className="tool-icon" /><span>{tc.name}</span>
        {summary && <span className="tool-call-summary" title={summary}>{summary}</span>}
        {failed && <span className="tool-call-badge-error">{language === 'en' ? 'error' : 'erro'}</span>}
      </button>
      {!isCollapsed && (
        <>
          <pre className="tool-call-args">{JSON.stringify(tc.arguments, null, 2)}</pre>
          {result && (
            tc.name === 'web_search'
              // Render search results as markdown so the source
              // links are clickable (citation-ready format from
              // electron/web-search-util.js).
              ? <div className="tool-result tool-result-search" dangerouslySetInnerHTML={{ __html: formatMarkdown(result.result || '') }} />
              : <div className="tool-result"><Terminal size={12} /><pre>{result.result}</pre></div>
          )}
        </>
      )}
    </div>
  )
}

const ToolCallBlock = memo(ToolCallBlockInner)
export default ToolCallBlock
