import { useEffect, useMemo, useState } from 'react'
import { X, LineChart, Trash2, Download, ChevronDown, ChevronRight, CornerDownRight, Sparkles, Loader2 } from 'lucide-react'
import {
  summarizeInsights,
  formatInsightsReport,
  drillEvents,
  type DrillSelector,
  type InsightEvent,
  type InsightsDigest,
} from './services/devInsights'
import { runInsightsAnalysis } from './services/insightsAnalysis'
import type { CompactionProviderConfig } from './services/compaction'
import { formatMarkdown } from './utils/formatting'

interface Props {
  isOpen: boolean
  onClose: () => void
  language: 'pt' | 'en'
  /** Provider configurado — usado pela auto-análise (v2.18.0). */
  providerConfig: CompactionProviderConfig
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12,
  padding: '4px 0', fontSize: 13, borderBottom: '1px solid rgba(127,127,127,0.12)',
}
const sectionStyle: React.CSSProperties = { marginBottom: 16 }

/** Read-only view of the privacy-safe usage telemetry (Dev Insights). Loads
 *  the raw events, aggregates with summarizeInsights, and lets the user export
 *  a Markdown report or clear the data. */
// Renderização compacta do meta de um evento na timeline ("name=write_file ms=380").
const META_KEYS = ['name', 'feature', 'kind', 'outcome', 'ms', 'totalMs', 'steps', 'step', 'waitMs', 'reasoningMs', 'toolMs', 'contentMs', 'prevToolMs', 'provider', 'model', 'v'] as const
function metaSummary(m?: InsightEvent['m']): string {
  if (!m) return ''
  return META_KEYS.filter((k) => m[k] !== undefined).map((k) => `${k}=${m[k]}`).join(' · ')
}

function eventTime(t: number, now: number): string {
  const d = new Date(t)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  const hms = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return sameDay ? hms : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hms}`
}

export default function DevInsightsPanel({ isOpen, onClose, language, providerConfig }: Props) {
  const [events, setEvents] = useState<InsightEvent[]>([])
  const [loading, setLoading] = useState(false)
  // Drill-down ativo: finding expandido e/ou timeline de turno aberta a
  // partir de um evento (sel é a fonte; turnSel sobrepõe quando navegado).
  const [openDrill, setOpenDrill] = useState<string | null>(null)
  const [turnDrill, setTurnDrill] = useState<{ from: string; id: string } | null>(null)
  // Auto-análise pelo modelo configurado (v2.18.0).
  const [analysis, setAnalysis] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; text: string }>({ status: 'idle', text: '' })
  const pt = language === 'pt'

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setOpenDrill(null)
    setTurnDrill(null)
    setAnalysis({ status: 'idle', text: '' })
    window.electron.devInsightsLoad()
      .then((e) => setEvents(Array.isArray(e) ? e : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [isOpen])

  const digest = useMemo<InsightsDigest>(() => summarizeInsights(events), [events])

  if (!isOpen) return null

  const handleExport = async () => {
    const result = await window.electron.saveDialog({
      defaultName: 'dev-insights.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (!result.filePath) return
    // A análise da IA (quando rodou) vai junto no export.
    const analysisSection = analysis.status === 'done'
      ? `\n\n# Análise da IA (${providerConfig.model})\n\n${analysis.text}\n`
      : ''
    await window.electron.writeFile({ filePath: result.filePath, content: formatInsightsReport(digest) + analysisSection })
  }

  const handleAnalyze = async () => {
    if (analysis.status === 'running') return
    setAnalysis({ status: 'running', text: '' })
    const { report, error } = await runInsightsAnalysis(providerConfig, digest, events, language)
    if (error) setAnalysis({ status: 'error', text: error })
    else setAnalysis({ status: 'done', text: report })
  }

  const handleClear = async () => {
    if (confirm(pt ? 'Apagar todos os dados de uso (Dev Insights)?' : 'Clear all Dev Insights usage data?')) {
      await window.electron.devInsightsClear()
      setEvents([])
    }
  }

  const rows = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1])

  const Section = ({ title, rec }: { title: string; rec: Record<string, number> }) => {
    const r = rows(rec)
    if (r.length === 0) return null
    return (
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>{title}</h3>
        {r.map(([k, v]) => (
          <div key={k} style={rowStyle}><span>{k}</span><strong>{v}</strong></div>
        ))}
      </div>
    )
  }

  const f = digest.friction
  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="analytics-modal">
        <div className="analytics-header">
          <div className="analytics-title-group">
            <LineChart size={20} />
            <div>
              <h2>Dev Insights</h2>
              <p className="analytics-subtitle">
                {pt
                  ? 'Telemetria de uso local e privada — só eventos, sem conteúdo de mensagens.'
                  : 'Local, private usage telemetry — events only, no message content.'}
              </p>
            </div>
          </div>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <p style={{ opacity: 0.6 }}>…</p>
          ) : digest.totalEvents === 0 ? (
            <p style={{ opacity: 0.6 }}>
              {pt ? 'Sem dados ainda. Use o chat e os dados aparecem aqui.' : 'No data yet. Use the chat and data appears here.'}
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12, opacity: 0.6, marginTop: 0 }}>
                {digest.totalEvents} {pt ? 'eventos' : 'events'} · {pt ? 'janela' : 'window'} {digest.windowDays}d
              </p>
              {analysis.status !== 'idle' && (
                <div style={{
                  ...sectionStyle, padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(127,127,127,0.07)', border: '1px solid rgba(127,127,127,0.18)',
                }}>
                  <h3 style={{ fontSize: 13, opacity: 0.8, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={13} /> {pt ? `Análise da IA (${providerConfig.model})` : `AI analysis (${providerConfig.model})`}
                  </h3>
                  {analysis.status === 'running' && (
                    <p style={{ fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                      <Loader2 size={12} className="spin" /> {pt ? 'analisando a telemetria…' : 'analyzing telemetry…'}
                    </p>
                  )}
                  {analysis.status === 'error' && (
                    <p style={{ fontSize: 12, margin: 0, color: 'var(--error, #e5484d)' }}>{analysis.text}</p>
                  )}
                  {analysis.status === 'done' && (
                    <div className="message-text" style={{ fontSize: 12.5 }}
                         dangerouslySetInnerHTML={{ __html: formatMarkdown(analysis.text, false) }} />
                  )}
                </div>
              )}
              <Section title={pt ? 'Erros por categoria' : 'Errors by kind'} rec={digest.errorsByKind} />
              <Section title={pt ? 'Features usadas' : 'Feature usage'} rec={digest.featureUsage} />
              <Section title={pt ? 'Tools' : 'Tools'} rec={digest.toolUsage} />
              <Section title={pt ? 'Provedores' : 'Providers'} rec={digest.providerMix} />
              <Section title={pt ? 'Modelos' : 'Models'} rec={digest.modelMix} />
              <Section title={pt ? 'Versões' : 'Versions'} rec={digest.versionMix} />
              {digest.comparison && (() => {
                const { current: cur, previous: prev, newErrorKinds, resolvedErrorKinds } = digest.comparison
                // lowerIsBetter=true → queda fica verde, alta vermelha; null = neutro.
                const Delta = ({ label, before, after, unit = '', lowerIsBetter = true as boolean | null }:
                  { label: string; before: number; after: number; unit?: string; lowerIsBetter?: boolean | null }) => {
                  const changed = after !== before
                  const better = lowerIsBetter === null || !changed ? null : (after < before) === lowerIsBetter
                  const color = better === null ? undefined : better ? 'var(--success, #46a758)' : 'var(--error, #e5484d)'
                  return (
                    <div style={rowStyle}>
                      <span>{label}</span>
                      <strong style={color ? { color } : undefined}>{before}{unit} → {after}{unit}</strong>
                    </div>
                  )
                }
                return (
                  <div style={sectionStyle}>
                    <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>
                      {pt ? `O que mudou (${prev.v} → ${cur.v})` : `What changed (${prev.v} → ${cur.v})`}
                    </h3>
                    <Delta label={pt ? `turnos na amostra` : `turns in sample`} before={prev.turns} after={cur.turns} lowerIsBetter={null} />
                    <Delta label={pt ? 'erros/turno' : 'errors/turn'} before={prev.errorRate} after={cur.errorRate} />
                    <Delta label={pt ? 'zumbis/turno' : 'zombies/turn'} before={prev.zombieRate} after={cur.zombieRate} />
                    <Delta label={pt ? 'retries/turno' : 'retries/turn'} before={prev.retryRate} after={cur.retryRate} />
                    <Delta label={pt ? 'latência média' : 'avg latency'} before={prev.avgLatencyMs} after={cur.avgLatencyMs} unit="ms" />
                    <Delta label={pt ? 'montagem de tool' : 'tool assembly'} before={prev.toolSharePct} after={cur.toolSharePct} unit="%" lowerIsBetter={null} />
                    <Delta label={pt ? 'raciocínio' : 'reasoning'} before={prev.reasoningSharePct} after={cur.reasoningSharePct} unit="%" lowerIsBetter={null} />
                    {newErrorKinds.length > 0 && (
                      <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--error, #e5484d)' }}>
                        {pt ? 'erros novos: ' : 'new errors: '}{newErrorKinds.join(', ')}
                      </p>
                    )}
                    {resolvedErrorKinds.length > 0 && (
                      <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--success, #46a758)' }}>
                        {pt ? 'erros resolvidos: ' : 'resolved errors: '}{resolvedErrorKinds.join(', ')}
                      </p>
                    )}
                  </div>
                )
              })()}
              {digest.turns.started > 0 && (
                <div style={sectionStyle}>
                  <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>{pt ? 'Turnos' : 'Turns'}</h3>
                  <div style={rowStyle}><span>{pt ? 'iniciados' : 'started'}</span><strong>{digest.turns.started}</strong></div>
                  <div style={rowStyle}><span>{pt ? 'completos' : 'completed'}</span><strong>{digest.turns.completed}</strong></div>
                  <div style={rowStyle}><span>{pt ? 'abortados' : 'aborted'}</span><strong>{digest.turns.aborted}</strong></div>
                  <div style={rowStyle}><span>{pt ? 'com erro' : 'errored'}</span><strong>{digest.turns.errored}</strong></div>
                  <div style={rowStyle}>
                    <span>{pt ? 'zumbis (sem desfecho)' : 'zombies (no outcome)'}</span>
                    <strong style={digest.turns.zombies > 0 ? { color: 'var(--error, #e5484d)' } : undefined}>{digest.turns.zombies}</strong>
                  </div>
                </div>
              )}
              {digest.streamShare.samples > 0 && (() => {
                const s = digest.streamShare
                const total = s.waitMs + s.reasoningMs + s.toolMs + s.contentMs
                const pct = (ms: number) => total > 0 ? `${Math.round((ms / total) * 100)}%` : '0%'
                return (
                  <div style={sectionStyle}>
                    <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>
                      {pt ? 'Perfil de geração (onde foi o tempo)' : 'Generation profile (where time went)'}
                    </h3>
                    <div style={rowStyle}><span>{pt ? 'espera 1º token' : 'first-token wait'}</span><strong>{pct(s.waitMs)}</strong></div>
                    <div style={rowStyle}><span>{pt ? 'raciocínio' : 'reasoning'}</span><strong>{pct(s.reasoningMs)}</strong></div>
                    <div style={rowStyle}><span>{pt ? 'montagem de tool' : 'tool assembly'}</span><strong>{pct(s.toolMs)}</strong></div>
                    <div style={rowStyle}><span>{pt ? 'texto' : 'text'}</span><strong>{pct(s.contentMs)}</strong></div>
                    <div style={rowStyle}><span>{pt ? 'montagens de tool 5+ min' : '5+ min tool assemblies'}</span><strong>{s.longToolAssemblies}</strong></div>
                    {Object.keys(s.toolMsByName || {}).length > 0 && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed rgba(127,127,127,0.18)' }}>
                        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>
                          {pt ? 'montagem por ferramenta' : 'assembly by tool'}
                        </div>
                        {Object.entries(s.toolMsByName).sort((a, b) => b[1] - a[1]).map(([n, ms]) => (
                          <div key={n} style={rowStyle}>
                            <span style={{ fontFamily: n === 'unattributed' ? undefined : 'monospace' }}>{n}</span>
                            <strong>{s.toolMs > 0 ? `${Math.round((ms / s.toolMs) * 100)}%` : '0%'}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
              <div style={sectionStyle}>
                <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>{pt ? 'Atrito' : 'Friction'}</h3>
                <div style={rowStyle}><span>circuit-breaks</span><strong>{f.circuitBreaks}</strong></div>
                <div style={rowStyle}><span>retries</span><strong>{f.retries}</strong></div>
                <div style={rowStyle}><span>{pt ? 'tools negadas' : 'tool denials'}</span><strong>{f.toolDenials}</strong></div>
                <div style={rowStyle}><span>{pt ? 'respostas vazias' : 'empty replies'}</span><strong>{f.emptyReplies}</strong></div>
                <div style={rowStyle}><span>{pt ? 'compactações' : 'compactions'}</span><strong>{f.contextCompactions}</strong></div>
                <div style={rowStyle}><span>{pt ? 'reescritas (era p/ ser edit_file)' : 'rewrites (should be edit_file)'}</span><strong>{f.rewriteExisting}</strong></div>
              </div>
              {digest.latency.count > 0 && (
                <div style={sectionStyle}>
                  <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>{pt ? 'Latência' : 'Latency'}</h3>
                  <div style={rowStyle}><span>{pt ? 'média' : 'avg'}</span><strong>{digest.latency.avgMs}ms</strong></div>
                  <div style={rowStyle}><span>p95</span><strong>{digest.latency.p95Ms}ms</strong></div>
                </div>
              )}
              {digest.findings.length > 0 && (
                <div style={sectionStyle}>
                  <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>
                    {pt ? 'Achados (por impacto)' : 'Findings (by impact)'}
                  </h3>
                  {digest.findings.map((f) => {
                    const color = f.severity === 'critical' ? 'var(--error, #e5484d)'
                      : f.severity === 'warning' ? '#f5a524'
                      : 'var(--text-secondary, #888)'
                    const isOpen = openDrill === f.id
                    const inTurnView = isOpen && turnDrill?.from === f.id
                    const sel: DrillSelector | undefined = inTurnView ? { type: 'turn', id: turnDrill!.id } : f.drill
                    const drilled = isOpen && sel ? drillEvents(events, sel, Date.now()) : []
                    return (
                      <div key={f.id} style={{ margin: '0 0 10px', fontSize: 12 }}>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: f.drill ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (!f.drill) return
                            setTurnDrill(null)
                            setOpenDrill(isOpen ? null : f.id)
                          }}
                          title={f.drill ? (pt ? 'Clique para ver os eventos por trás' : 'Click to see the events behind this') : undefined}
                        >
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
                          }} aria-label={f.severity} title={f.severity} />
                          <strong>{f.title}</strong>
                          {f.drill && (isOpen ? <ChevronDown size={12} style={{ opacity: 0.6 }} /> : <ChevronRight size={12} style={{ opacity: 0.6 }} />)}
                        </div>
                        <div style={{ opacity: 0.85, margin: '2px 0 0 14px' }}>{f.evidence}</div>
                        <div style={{ opacity: 0.65, margin: '1px 0 0 14px', fontStyle: 'italic' }}>→ {f.recommendation}</div>
                        {isOpen && (
                          <div style={{
                            margin: '6px 0 0 14px', padding: '6px 8px', borderRadius: 6,
                            background: 'rgba(127,127,127,0.07)', border: '1px solid rgba(127,127,127,0.15)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, opacity: 0.7 }}>
                              {inTurnView ? (
                                <>
                                  <button
                                    onClick={() => setTurnDrill(null)}
                                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 11, textDecoration: 'underline' }}
                                  >← {pt ? 'voltar' : 'back'}</button>
                                  <span>{pt ? `timeline do turno ${turnDrill!.id}` : `turn ${turnDrill!.id} timeline`}</span>
                                </>
                              ) : (
                                <span>{pt ? 'eventos por trás do achado' : 'events behind this finding'}{drilled.length === 50 ? (pt ? ' (50 mais recentes)' : ' (50 most recent)') : ''}</span>
                              )}
                            </div>
                            {drilled.length === 0 && (
                              <div style={{ opacity: 0.6 }}>{pt ? 'nenhum evento na janela' : 'no events in window'}</div>
                            )}
                            {drilled.map((e, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', fontFamily: 'monospace', fontSize: 11, alignItems: 'baseline' }}>
                                <span style={{ opacity: 0.55, flexShrink: 0 }}>{eventTime(e.t, Date.now())}</span>
                                <span style={{ flexShrink: 0 }}>[{e.c}/{e.a}]</span>
                                <span style={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metaSummary(e.m)}</span>
                                {!inTurnView && typeof e.m?.turn === 'string' && (
                                  <button
                                    onClick={() => setTurnDrill({ from: f.id, id: e.m!.turn as string })}
                                    title={pt ? 'Ver tudo que este turno fez' : 'See everything this turn did'}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent, #6e9eff)', cursor: 'pointer', padding: 0, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
                                  >
                                    <CornerDownRight size={10} /> {pt ? 'ver turno' : 'view turn'}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(127,127,127,0.15)' }}>
          <button className="settings-close" style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto', padding: '6px 12px' }}
                  onClick={handleAnalyze} disabled={digest.totalEvents === 0 || analysis.status === 'running'}
                  title={pt ? 'Envia o digest + amostra de eventos (sem conteúdo de mensagens) ao modelo configurado' : 'Sends the digest + event sample (no message content) to the configured model'}>
            {analysis.status === 'running' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {pt ? 'Analisar com IA' : 'Analyze with AI'}
          </button>
          <button className="settings-close" style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto', padding: '6px 12px' }}
                  onClick={handleExport} disabled={digest.totalEvents === 0}>
            <Download size={14} /> {pt ? 'Exportar .md' : 'Export .md'}
          </button>
          <button className="settings-close" style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto', padding: '6px 12px' }}
                  onClick={handleClear} disabled={digest.totalEvents === 0}>
            <Trash2 size={14} /> {pt ? 'Limpar' : 'Clear'}
          </button>
        </div>
      </div>
    </div>
  )
}
