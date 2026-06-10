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

export const SUMMARY_MAX_CHARS = 2000

/** Flatten a message slice for the summarizer, INCLUDING tool results. */
export function flattenForCompaction(
  messages: Array<Partial<Message>>,
  maxContent = 500,
  maxToolResult = 300,
): string {
  const lines: string[] = []
  for (const m of messages || []) {
    const content = (m.content || '').slice(0, maxContent)
    if (content) lines.push(`[${m.role}]: ${content}`)
    if (m.toolCalls?.length) {
      m.toolCalls.forEach((tc, i) => {
        const result = (m.toolResults?.[i]?.result || '').slice(0, maxToolResult)
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
  const pt = language === 'pt'
  let prompt = pt
    ? 'Resuma a conversa abaixo em um parágrafo compacto preservando: (1) fatos-chave mencionados, (2) decisões tomadas, (3) arquivos/caminhos referenciados, (4) estado atual do trabalho. Seja denso e factual, sem floreios. Máximo 300 palavras.'
    : 'Summarize the conversation below in one compact paragraph preserving: (1) key facts mentioned, (2) decisions made, (3) files/paths referenced, (4) current state of work. Be dense and factual, no fluff. Maximum 300 words.'
  const extra = (instructions || '').trim()
  if (extra) {
    prompt += pt ? `\nInstruções adicionais do usuário: ${extra}` : `\nAdditional user instructions: ${extra}`
  }
  return [
    { role: 'system', content: prompt },
    { role: 'user', content: flattenForCompaction(messages) },
  ]
}

/** Append a new summary to the running one, capped at `maxChars` keeping the
 *  TAIL (newest information). When the cap cuts mid-line, the partial first
 *  line is dropped so the stored summary doesn't start mid-sentence. */
export function mergeSummary(prev: string, next: string, maxChars = SUMMARY_MAX_CHARS): string {
  const merged = prev ? `${prev}\n\n${next}` : next
  if (merged.length <= maxChars) return merged
  let tail = merged.slice(-maxChars)
  const firstBreak = tail.indexOf('\n')
  if (firstBreak > -1 && firstBreak < 200) tail = tail.slice(firstBreak + 1)
  return tail
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
        max_tokens: 500,
        modalHostname: cfg.modalHostname,
        customBaseUrl: cfg.customBaseUrl,
      })
      if (res?.error) return { summary: '', error: String(res.error) }
      return { summary: res?.choices?.[0]?.message?.content || '', error: null }
    }
    // Ollama: keep the dedicated local handler (it owns the localhost call).
    const res = await window.electron.compactContext({
      messages: messages as any[],
      model: cfg.model,
      language,
      provider: cfg.provider,
    })
    return { summary: res?.summary || '', error: res?.error || null }
  } catch (e: any) {
    return { summary: '', error: e?.message || String(e) }
  }
}
