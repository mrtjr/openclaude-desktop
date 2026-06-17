// ─── Context compaction — provider-agnostic ─────────────────────────
//
// AUDIT FINDING (v2.12.53): the compact-context IPC handler in main.js is
// hardwired to Ollama (localhost:11434) and returns { skipped: true } for any
// other provider — so for a user on Modal/OpenAI/Anthropic, EVERY compaction
// path (/compact, the panel's "Compactar agora", and the automatic summary on
// history drop) silently did nothing, and "Memória / resumo" stayed at 0
// forever. This service builds the compaction request in the renderer (which
// already knows how to authenticate every provider) and routes it through the
// same non-streaming `provider-chat` IPC the chat uses; Ollama keeps the
// existing dedicated handler.
//
// It also fixes two quality gaps of the old prompt builder:
//  - tool RESULTS are now included in the flattened transcript (an
//    agent-heavy conversation is mostly tool traffic — summaries that
//    ignored it were hollow);
//  - custom instructions from `/compact <instruções>` actually reach the
//    prompt (the IPC handler silently dropped them).

import type { Message } from '../types'
import {
  buildStructuredCompactionPrompt,
  mergeSummaryStructured,
  STRUCTURED_SUMMARY_MAX_CHARS,
} from '../utils/structuredSummary'

// O resumo agora é ESTRUTURADO (seções + dedup + merge que preserva o
// objetivo). Ver utils/structuredSummary.ts. O teto subiu de 2000 → 4000
// chars porque o formato seccionado é mais denso e é contabilizado no budget
// de tokens em useChat (computeMessageBudget). (v2.59.0)
export const SUMMARY_MAX_CHARS = STRUCTURED_SUMMARY_MAX_CHARS

/** Clip a tool result keeping BOTH the head and the tail. execute_command
 *  emits stdout first, then stderr, then `[exit code: N]` LAST (see
 *  formatExecResult) — a head-only slice would drop exactly the success/
 *  failure signal a summary must preserve. So for long results we keep the
 *  start (what ran / beginning of output) AND the end (stderr + exit code). */
export function clipToolResult(result: string, max: number): string {
  if (result.length <= max) return result
  const marker = ' …[corte]… '
  const budget = Math.max(0, max - marker.length)
  const head = Math.ceil(budget * 0.55)
  const tail = budget - head
  return result.slice(0, head) + marker + result.slice(result.length - tail)
}

/** Flatten a message slice for the summarizer, INCLUDING tool results. */
export function flattenForCompaction(
  messages: Array<Partial<Message>>,
  maxContent = 500,
  maxToolResult = 1500,
): string {
  const lines: string[] = []
  for (const m of messages || []) {
    const content = (m.content || '').slice(0, maxContent)
    if (content) lines.push(`[${m.role}]: ${content}`)
    if (m.toolCalls?.length) {
      m.toolCalls.forEach((tc, i) => {
        const raw = m.toolResults?.[i]?.result || ''
        const result = clipToolResult(raw, maxToolResult)
        lines.push(`[tool ${tc.name}]: ${result || '(sem resultado)'}`)
      })
    }
  }
  return lines.join('\n')
}

/** Build the summarization request (system prompt + flattened transcript). */
export function buildCompactionMessages(
  messages: Array<Partial<Message>>,
  language: string,
  instructions?: string,
): Array<{ role: string; content: string }> {
  // Resumo ESTRUTURADO (seções Objetivo/Decisões/Fatos/Arquivos/Estado/
  // Pendências) em vez do parágrafo plano antigo — ver structuredSummary.ts.
  const prompt = buildStructuredCompactionPrompt(language, instructions)
  return [
    { role: 'system', content: prompt },
    { role: 'user', content: flattenForCompaction(messages) },
  ]
}

/** Funde o resumo novo no acumulado de forma ESTRUTURADA: faz parse das duas
 *  strings em seções, deduplica e funde por seção, e ajusta ao teto cortando o
 *  conteúdo VOLÁTIL primeiro — as seções duráveis (objetivo/decisões/fatos)
 *  nunca são descartadas. Substitui o append+corte-de-rabo antigo, que perdia
 *  o objetivo declarado no início de conversas longas. Mantém a assinatura
 *  (prev, next, maxChars) usada pelos chamadores; `lang` controla os rótulos
 *  de saída (default pt). Ver utils/structuredSummary.ts. (v2.59.0) */
export function mergeSummary(
  prev: string,
  next: string,
  maxChars = SUMMARY_MAX_CHARS,
  lang: string = 'pt',
): string {
  return mergeSummaryStructured(prev, next, maxChars, lang)
}

export const EMERGENCY_KEEP_RECENT = 4

/** Plan an emergency compaction of an in-flight agent message array (when the
 *  provider reports a context overflow mid-turn). The first `prefixLen`
 *  messages (system / memory / priming) are always preserved, and the last
 *  `keepRecent` are kept verbatim for continuity; everything between is the
 *  region to summarize. Returns null when there's nothing between the prefix
 *  and the kept tail (compaction wouldn't free anything). Pure. */
export function planEmergencyCompaction(
  total: number,
  prefixLen: number,
  keepRecent = EMERGENCY_KEEP_RECENT,
): { regionStart: number; regionEnd: number; tailStart: number } | null {
  const tailStart = Math.max(prefixLen, total - keepRecent)
  if (tailStart - prefixLen <= 0) return null
  return { regionStart: prefixLen, regionEnd: tailStart, tailStart }
}

export interface CompactionProviderConfig {
  provider: string
  model: string
  apiKey?: string
  isNotOllama: boolean
  modalHostname?: string
  customBaseUrl?: string
}

/** Run a compaction through the user's REAL provider. Returns the summary or
 *  an error string — never throws. */
export async function runCompaction(
  cfg: CompactionProviderConfig,
  messages: Array<Partial<Message>>,
  language: string,
  instructions?: string,
): Promise<{ summary: string; error: string | null }> {
  try {
    if (cfg.isNotOllama) {
      const res = await window.electron.providerChat({
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages: buildCompactionMessages(messages, language, instructions),
        tools: [],
        temperature: 0.1,
        // Resumo estruturado (6 seções com bullets) é mais longo que o
        // parágrafo antigo — dá folga para não cortar no meio. (v2.59.0)
        max_tokens: 800,
        modalHostname: cfg.modalHostname,
        customBaseUrl: cfg.customBaseUrl,
      })
      if (res?.error) return { summary: '', error: String(res.error) }
      return { summary: res?.choices?.[0]?.message?.content || '', error: null }
    }
    // Ollama: roda pelo IPC ollama-chat local (localhost:11434, sem auth) com as
    // MESMAS mensagens estruturadas dos demais providers. Antes o Ollama tinha
    // um handler dedicado com um prompt plano antigo que (a) descartava os
    // resultados de ferramentas (placeholder "(tool call)"), (b) ignorava as
    // instruções do `/compact`, e (c) produzia texto não-seccionado que o
    // mergeSummaryStructured fundia mal — ficou para trás no resumo estruturado
    // (v2.59.0). Como Ollama é o provider padrão do app, isso degradava o caso
    // mais comum; unificado aqui.
    const res = await window.electron.ollamaChat({
      model: cfg.model,
      messages: buildCompactionMessages(messages, language, instructions),
      temperature: 0.1,
      max_tokens: 800,
    })
    if (res?.error) return { summary: '', error: String(res.error) }
    return { summary: res?.choices?.[0]?.message?.content || '', error: null }
  } catch (e: any) {
    return { summary: '', error: e?.message || String(e) }
  }
}
