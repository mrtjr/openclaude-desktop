import { useEffect, useMemo, useState } from 'react'
import { X, LineChart, Trash2, Download } from 'lucide-react'
import {
  summarizeInsights,
  formatInsightsReport,
  type InsightEvent,
  type InsightsDigest,
} from './services/devInsights'

interface Props {
  isOpen: boolean
  onClose: () => void
  language: 'pt' | 'en'
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12,
  padding: '4px 0', fontSize: 13, borderBottom: '1px solid rgba(127,127,127,0.12)',
}
const sectionStyle: React.CSSProperties = { marginBottom: 16 }

/** Read-only view of the privacy-safe usage telemetry (Dev Insights). Loads
 *  the raw events, aggregates with summarizeInsights, and lets the user export
 *  a Markdown report or clear the data. */
export default function DevInsightsPanel({ isOpen, onClose, language }: Props) {
  const [events, setEvents] = useState<InsightEvent[]>([])
  const [loading, setLoading] = useState(false)
  const pt = language === 'pt'

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
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
    await window.electron.writeFile({ filePath: result.filePath, content: formatInsightsReport(digest) })
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
              </div>
              {digest.latency.count > 0 && (
                <div style={sectionStyle}>
                  <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>{pt ? 'Latência' : 'Latency'}</h3>
                  <div style={rowStyle}><span>{pt ? 'média' : 'avg'}</span><strong>{digest.latency.avgMs}ms</strong></div>
                  <div style={rowStyle}><span>p95</span><strong>{digest.latency.p95Ms}ms</strong></div>
                </div>
              )}
              {digest.notes.length > 0 && (
                <div style={sectionStyle}>
                  <h3 style={{ fontSize: 13, opacity: 0.7, margin: '0 0 6px' }}>{pt ? 'Notas' : 'Notes'}</h3>
                  {digest.notes.map((n, i) => (
                    <p key={i} style={{ fontSize: 12, margin: '4px 0', opacity: 0.85 }}>• {n}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(127,127,127,0.15)' }}>
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
