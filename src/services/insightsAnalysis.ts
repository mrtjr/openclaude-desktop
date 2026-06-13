// ─── Auto-análise do Dev Insights (v2.18.0) ─────────────────────────
//
// Opção 5 do plano de evolução: o app usa o PRÓPRIO modelo configurado para
// analisar a própria telemetria — digest agregado + amostra de eventos crus
// entram, relatório narrativo priorizado sai. Privacidade preservada por
// construção: os eventos só têm categorias e metadados primitivos (nunca
// conteúdo de mensagem), então nada sensível novo é enviado ao provider.
//
// Mesma arquitetura da compactação cloud (services/compaction.ts): o prompt
// é montado aqui (puro, testável) e roteado pelo IPC não-streaming que o
// chat já usa (`provider-chat` / `ollama-chat`, ambos OpenAI-shaped).

import type { InsightsDigest, InsightEvent } from './devInsights'
import { formatInsightsReport } from './devInsights'
import type { CompactionProviderConfig } from './compaction'

/** Amostra de eventos crus enviada junto do digest (mais novos primeiro). */
export const ANALYSIS_EVENT_SAMPLE = 120

/** Achata eventos em linhas compactas para o prompt:
 *  `2026-06-12T23:20:23Z [chat/turn] provider=modal · model=glm · v=2.14.0` */
export function flattenEventsForAnalysis(events: InsightEvent[], cap = ANALYSIS_EVENT_SAMPLE): string {
  const newest = [...events].sort((a, b) => b.t - a.t).slice(0, cap)
  return newest.map((e) => {
    const meta = e.m ? Object.entries(e.m).map(([k, v]) => `${k}=${v}`).join(' · ') : ''
    return `${new Date(e.t).toISOString()} [${e.c}/${e.a}]${meta ? ' ' + meta : ''}`
  }).join('\n')
}

/** Monta a requisição de análise (system + user). Puro. */
export function buildAnalysisMessages(
  digest: InsightsDigest,
  events: InsightEvent[],
  language: string,
): Array<{ role: string; content: string }> {
  const pt = language === 'pt'
  const system = pt
    ? `Você é o analista de engenharia do OpenClaude Desktop, analisando a telemetria local do próprio app (apenas eventos e metadados — nunca conteúdo de mensagens). Com base no digest agregado e na amostra de eventos crus, escreva um relatório em markdown com EXATAMENTE estas seções:
## Diagnóstico — 2 a 4 frases sobre o estado geral do app.
## Top 3 prioridades — lista numerada; cada item com a evidência numérica dos dados e por que importa.
## Hipóteses — anomalias ou padrões estranhos que merecem investigação (se houver).
## Próximo ciclo sugerido — UMA recomendação concreta de trabalho, com justificativa.
## Monitorar — o que observar nos próximos dias para confirmar tendências.
Regras: cite números reais dos dados; não invente nada que não esteja neles; se a amostra for pequena demais para concluir algo, diga isso. Seja direto.`
    : `You are the engineering analyst for OpenClaude Desktop, analyzing the app's own local telemetry (events and metadata only — never message content). Based on the aggregated digest and the raw event sample, write a markdown report with EXACTLY these sections:
## Diagnosis — 2-4 sentences on overall app health.
## Top 3 priorities — numbered list; each with the numeric evidence and why it matters.
## Hypotheses — anomalies or odd patterns worth investigating (if any).
## Suggested next cycle — ONE concrete work recommendation, justified.
## Watch — what to monitor over the next days to confirm trends.
Rules: cite real numbers from the data; never invent data; if the sample is too small to conclude something, say so. Be direct.`

  const user = [
    pt ? '=== DIGEST AGREGADO ===' : '=== AGGREGATED DIGEST ===',
    formatInsightsReport(digest),
    '',
    pt ? `=== AMOSTRA DE EVENTOS CRUS (${ANALYSIS_EVENT_SAMPLE} mais recentes, mais novos primeiro) ===` : `=== RAW EVENT SAMPLE (${ANALYSIS_EVENT_SAMPLE} most recent, newest first) ===`,
    flattenEventsForAnalysis(events),
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Roda a análise no provider configurado. Devolve o relatório ou erro —
 *  nunca lança (mesmo contrato do runCompaction). */
export async function runInsightsAnalysis(
  cfg: CompactionProviderConfig,
  digest: InsightsDigest,
  events: InsightEvent[],
  language: string,
): Promise<{ report: string; error: string | null }> {
  try {
    const messages = buildAnalysisMessages(digest, events, language)
    const params = {
      model: cfg.model,
      messages,
      tools: [],
      temperature: 0.3,
      max_tokens: 1500,
    }
    const res = cfg.isNotOllama
      ? await window.electron.providerChat({
          ...params,
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          modalHostname: cfg.modalHostname,
          customBaseUrl: cfg.customBaseUrl,
        })
      : await window.electron.ollamaChat(params)
    if (res?.error) return { report: '', error: String(res.error) }
    const report = res?.choices?.[0]?.message?.content || ''
    return report
      ? { report, error: null }
      : { report: '', error: language === 'pt' ? 'O modelo devolveu resposta vazia.' : 'Model returned an empty response.' }
  } catch (e: any) {
    return { report: '', error: e?.message || String(e) }
  }
}
