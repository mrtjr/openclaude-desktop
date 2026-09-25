import React, { memo, useState } from 'react'
import { Play, ChevronDown, Wrench, Terminal } from 'lucide-react'
import type { ToolCall, ToolResult } from '../types'
import { formatMarkdown } from '../utils/formatting'
import { toolCallSummary, shouldRenderToolResultAsMarkdown } from '../utils/toolDisplay'
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
  
  const isPending = !result
  const failed = !!result && (!!result.error || (!!resultText && isToolError(resultText, tc.name)))
  const isSuccess = !!result && !failed

  // Se for interagido manualmente, usamos a prop ou state local. 
  // Mas para não quebrar ChatMessage que passa onToggleCollapse,
  // vamos usar um estado local puro para gerenciar isso ou derivar de isPending/failed.
  const [userExpanded, setUserExpanded] = React.useState<boolean | null>(null)
  
  // Logica de Expansão Padrão: 
  // pendente ou erro -> expandido. sucesso -> colapsado.
  const autoExpanded = isPending || failed
  const isExpanded = userExpanded !== null ? userExpanded : autoExpanded

  const summary = toolCallSummary(tc.name, tc.arguments)
  
  let statusIcon = ''
  let statusText = ''
  let statusClasses = ''
  
  if (isPending) {
    statusIcon = '🔄'
    statusText = 'executando...'
    statusClasses = 'border-l-4 border-blue-400 animate-pulse bg-blue-50/10'
  } else if (failed) {
    statusIcon = '❌'
    statusText = 'falhou'
    statusClasses = 'border-l-4 border-red-500 bg-red-50/10'
  } else {
    statusIcon = '✅'
    statusText = 'concluída'
    statusClasses = 'border-l-4 border-green-500 bg-green-50/10'
  }

  return (
    <div className={`tool-call my-2 p-2 rounded-md shadow-sm transition-all duration-300 ${statusClasses}`}>
      <details 
        className="group" 
        open={isExpanded} 
        onToggle={(e) => {
          const isOpen = (e.target as HTMLDetailsElement).open;
          if (isOpen !== isExpanded) setUserExpanded(isOpen);
        }}
      >
        <summary className="tool-call-header cursor-pointer list-none flex items-center gap-2 font-medium text-sm select-none" onClick={(e) => e.preventDefault() /* prevent default toggle to use state controlled toggle */}>
          <div onClick={() => setUserExpanded(!isExpanded)} className="flex items-center gap-2 w-full">
            <span className="text-base">{statusIcon}</span>
            <span className="font-semibold text-gray-700 dark:text-gray-200">Ferramenta: {tc.name}</span>
            <span className="text-xs opacity-75 italic">({statusText})</span>
            {summary && <span className="tool-call-summary ml-auto truncate max-w-xs text-xs opacity-60" title={summary}>{summary}</span>}
            <ChevronDown size={14} className={`ml-auto transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
        </summary>
        
        <div className="mt-3 text-sm">
          <div className="font-mono text-xs bg-black/5 dark:bg-white/5 p-2 rounded mb-2 overflow-x-auto">
            <span className="opacity-50 select-none">// Argumentos:</span>
            <pre className="tool-call-args m-0 mt-1">{JSON.stringify(tc.arguments, null, 2)}</pre>
          </div>
          {result && (
            shouldRenderToolResultAsMarkdown(tc.name)
              ? <div className="tool-result tool-result-search border-t border-black/10 dark:border-white/10 pt-2" dangerouslySetInnerHTML={{ __html: formatMarkdown(result.result || '') }} />
              : (
                <div className="tool-result border-t border-black/10 dark:border-white/10 pt-2">
                  <div className="flex items-center gap-1 opacity-50 mb-1"><Terminal size={12} /> <span className="text-xs">Output:</span></div>
                  <pre className="overflow-x-auto bg-black/5 dark:bg-white/5 p-2 rounded text-xs max-h-96">{result.result}</pre>
                </div>
              )
          )}
        </div>
      </details>
    </div>
  )
}

const ToolCallBlock = memo(ToolCallBlockInner)
export default ToolCallBlock
