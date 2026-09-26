import { memo } from 'react'
import { Play, ChevronDown, Wrench, Terminal, Loader2, CheckCircle2, XCircle } from 'lucide-react'
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
//
// Status por estado (v2.213.0) — reimplementa a intenção do commit 59d56af
// (blocos colapsáveis: pendente/erro abertos, sucesso fechado, ícone de estado)
// sem as quatro regressões que ele trouxe:
//   1. estado LOCAL (useState) no lugar de collapsedTools/onToggleCollapse, o
//      que quebrava o contrato do memo e perdia a escolha do usuário;
//   2. <details> no lugar de render condicional — filhos de um <details>
//      fechado continuam no DOM, então todo resultado (com markdown) era
//      montado mesmo colapsado: o O(n²) acima, de volta;
//   3. classes Tailwind — o projeto NÃO tem Tailwind, então a borda de cor por
//      estado, o layout do cabeçalho e o giro da seta simplesmente não
//      existiam na tela;
//   4. texto fixo em português e cabeçalho sem acesso por teclado (o
//      preventDefault no <summary> anulava Enter/Espaço).

interface ToolCallBlockProps {
  tc: ToolCall
  result?: ToolResult
  toolKey: string
  language?: string
  /** Keys the user toggled away from their default collapsed state. */
  collapsedTools: Set<string>
  onToggleCollapse: (toolKey: string) => void
}

type ToolState = 'pending' | 'error' | 'ok'

function ToolCallBlockInner({
  tc, result, toolKey, language, collapsedTools, onToggleCollapse,
}: ToolCallBlockProps) {
  const en = language === 'en'
  const resultText = result?.result || ''
  const state: ToolState = !result
    ? 'pending'
    : (result.error || (resultText && isToolError(resultText, tc.name))) ? 'error' : 'ok'
  // Padrão por ESTADO: pendente e erro ficam abertos (é onde o usuário precisa
  // olhar); sucesso fecha (limpa o chat). `collapsedTools` guarda só as chaves
  // que o usuário ALTERNOU a partir desse padrão — o estado mora no pai, então
  // sobrevive a re-render e respeita o memo.
  const defaultCollapsed = state === 'ok'
  const isCollapsed = collapsedTools.has(toolKey) ? !defaultCollapsed : defaultCollapsed
  const summary = toolCallSummary(tc.name, tc.arguments)

  return (
    <div className={`tool-call tool-call--${state}`}>
      <button
        type="button"
        className="tool-call-header"
        onClick={() => onToggleCollapse(toolKey)}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? <Play size={10} className="tool-play" /> : <ChevronDown size={14} />}
        {state === 'pending' && <Loader2 size={12} className="tool-call-state animate-spin" aria-hidden="true" />}
        {state === 'error' && <XCircle size={12} className="tool-call-state" aria-hidden="true" />}
        {state === 'ok' && <CheckCircle2 size={12} className="tool-call-state" aria-hidden="true" />}
        <Wrench size={12} className="tool-icon" /><span>{tc.name}</span>
        {summary && <span className="tool-call-summary" title={summary}>{summary}</span>}
        {state === 'pending' && <span className="tool-call-status">{en ? 'running…' : 'executando…'}</span>}
        {state === 'error' && <span className="tool-call-badge-error">{en ? 'error' : 'erro'}</span>}
      </button>
      {/* Render CONDICIONAL, não <details>: colapsado = fora do DOM. É o que
          mantém barata uma rodada com centenas de ferramentas. */}
      {!isCollapsed && (
        <>
          <pre className="tool-call-args">{JSON.stringify(tc.arguments, null, 2)}</pre>
          {result && (
            shouldRenderToolResultAsMarkdown(tc.name)
              // Saída de prosa/markdown autoral (web_search, rag_search,
              // compare_models, visão): renderiza como markdown — links
              // clicáveis, títulos por modelo, citações de fonte. As demais
              // (logs/código) ficam em <pre> literal. Ver toolDisplay.ts.
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
