import { useState, useEffect } from 'react'
import { X, BarChart3, Zap, Wrench, AlertTriangle, Clock, Bot, Activity, Trash2, Shield } from 'lucide-react'

interface AnalyticsProps {
  isOpen: boolean
  onClose: () => void
  language: 'pt' | 'en'
}

interface Insights {
  hasData: boolean
  global?: { totalSessions: number; totalToolCalls: number; totalErrors: number; totalAgentRuns: number; totalCircuitBreaks: number }
  period?: { total: number; last7d: number; last24h: number }
  topTools?: { name: string; count: number }[]
  modelUsage?: { name: string; count: number }[]
  providerUsage?: { name: string; count: number }[]
  avgResponseTime?: number
  agentCompletionRate?: number
  avgAgentSteps?: number
  errorRate?: number
  totalAgentRuns?: number
  totalCircuitBreaks?: number
}

const labels = {
  pt: {
    title: 'Analytics & Insights',
    subtitle: 'Dados coletados localmente. Nenhum dado sai do seu computador.',
    noData: 'Nenhum dado coletado ainda. Use o chat e os dados aparecerão aqui.',
    overview: 'Visão Geral',
    sessions: 'Sessões',
    last24h: 'Últimas 24h',
    last7d: 'Últimos 7 dias',
    total: 'Total',
    toolCalls: 'Chamadas de Ferramentas',
    errors: 'Erros',
    circuitBreaks: 'Circuit Breaker',
    performance: 'Performance',
    avgResponse: 'Tempo médio de resposta',
    errorRate: 'Taxa de erro',
    agentMode: 'Modo Agente',
    agentRuns: 'Execuções',
    completionRate: 'Taxa de conclusão',
    avgSteps: 'Passos médios',
    topTools: 'Ferramentas mais usadas',
    models: 'Modelos usados',
    providers: 'Provedores',
    clearData: 'Limpar dados',
    clearConfirm: 'Tem certeza? Isso apagará todo o histórico de analytics.',
    uses: 'usos',
    ms: 'ms',
    security: 'Armazenamento local criptografado. Auto-purge: 30 dias.',
  },
  en: {
    title: 'Analytics & Insights',
    subtitle: 'Data collected locally. Nothing leaves your machine.',
    noData: 'No data collected yet. Use the chat and data will appear here.',
    overview: 'Overview',
    sessions: 'Sessions',
    last24h: 'Last 24h',
    last7d: 'Last 7 days',
    total: 'Total',
    toolCalls: 'Tool Calls',
    errors: 'Errors',
    circuitBreaks: 'Circuit Breaker',
    performance: 'Performance',
    avgResponse: 'Avg response time',
    errorRate: 'Error rate',
    agentMode: 'Agent Mode',
    agentRuns: 'Runs',
    completionRate: 'Completion rate',
    avgSteps: 'Avg steps',
    topTools: 'Most used tools',
    models: 'Models used',
    providers: 'Providers',
    clearData: 'Clear data',
    clearConfirm: 'Are you sure? This will delete all analytics history.',
    uses: 'uses',
    ms: 'ms',
    security: 'Local encrypted storage. Auto-purge: 30 days.',
  }
}

export default function AnalyticsDashboard({ isOpen, onClose, language }: AnalyticsProps) {
  const [insights, setInsights] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)
  const l = labels[language] || labels.pt

  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      window.electron.analyticsGetInsights()
        .then(setInsights)
        .catch(() => setInsights({ hasData: false }))
        .finally(() => setLoading(false))
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleClear = async () => {
    if (confirm(l.clearConfirm)) {
      await window.electron.analyticsClear()
      setInsights({ hasData: false })
    }
  }

  const maxToolCount = insights?.topTools?.[0]?.count || 1

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="analytics-modal">
        <div className="analytics-header">
          <div className="analytics-title-group">
            <BarChart3 size={20} />
            <div>
              <h2>{l.title}</h2>
              <p className="analytics-subtitle">{l.subtitle}</p>
            </div>
          </div>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="analytics-body">
          {loading ? (
            <div className="analytics-loading">
              <Activity size={24} className="spin" />
            </div>
          ) : !insights?.hasData ? (
            <div className="analytics-empty">
              <BarChart3 size={40} className="analytics-empty-icon" />
              <p>{l.noData}</p>
            </div>
          ) : (
            <>
              {/* Overview Cards */}
              <div className="analytics-section-title">{l.overview}</div>
              <div className="analytics-cards">
                <div className="analytics-card">
                  <div className="analytics-card-icon sessions"><Activity size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.period?.total || 0}</span>
                    <span className="analytics-card-label">{l.sessions}</span>
                  </div>
                  <div className="analytics-card-sub">
                    <span>{l.last24h}: {insights.period?.last24h || 0}</span>
                    <span>{l.last7d}: {insights.period?.last7d || 0}</span>
                  </div>
                </div>

                <div className="analytics-card">
                  <div className="analytics-card-icon tools"><Wrench size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.global?.totalToolCalls || 0}</span>
                    <span className="analytics-card-label">{l.toolCalls}</span>
                  </div>
                </div>

                <div className="analytics-card">
                  <div className="analytics-card-icon errors"><AlertTriangle size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.global?.totalErrors || 0}</span>
                    <span className="analytics-card-label">{l.errors}</span>
                  </div>
                </div>

                <div className="analytics-card">
                  <div className="analytics-card-icon circuit"><Shield size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.totalCircuitBreaks || 0}</span>
                    <span className="analytics-card-label">{l.circuitBreaks}</span>
                  </div>
                </div>
              </div>

              {/* Performance */}
              <div className="analytics-section-title">{l.performance}</div>
              <div className="analytics-cards">
                <div className="analytics-card wide">
                  <div className="analytics-card-icon perf"><Clock size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.avgResponseTime || 0}{l.ms}</span>
                    <span className="analytics-card-label">{l.avgResponse}</span>
                  </div>
                </div>
                <div className="analytics-card wide">
                  <div className="analytics-card-icon errors"><AlertTriangle size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.errorRate || 0}%</span>
                    <span className="analytics-card-label">{l.errorRate}</span>
                  </div>
                </div>
              </div>

              {/* Agent Mode */}
              <div className="analytics-section-title">{l.agentMode}</div>
              <div className="analytics-cards">
                <div className="analytics-card">
                  <div className="analytics-card-icon agent"><Zap size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.totalAgentRuns || 0}</span>
                    <span className="analytics-card-label">{l.agentRuns}</span>
                  </div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-icon sessions"><Activity size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.agentCompletionRate || 0}%</span>
                    <span className="analytics-card-label">{l.completionRate}</span>
                  </div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-icon perf"><Clock size={16} /></div>
                  <div className="analytics-card-data">
                    <span className="analytics-card-value">{insights.avgAgentSteps || 0}</span>
                    <span className="analytics-card-label">{l.avgSteps}</span>
                  </div>
                </div>
              </div>

              {/* Top Tools - Bar Chart */}
              {insights.topTools && insights.topTools.length > 0 && (
                <>
                  <div className="analytics-section-title">{l.topTools}</div>
                  <div className="analytics-bar-chart">
                    {insights.topTools.map(tool => (
                      <div key={tool.name} className="analytics-bar-row">
                        <span className="analytics-bar-label">{tool.name}</span>
                        <div className="analytics-bar-track">
                          <div className="analytics-bar-fill" style={{ width: `${(tool.count / maxToolCount) * 100}%` }} />
                        </div>
                        <span className="analytics-bar-value">{tool.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Models */}
              {insights.modelUsage && insights.modelUsage.length > 0 && (
                <>
                  <div className="analytics-section-title">{l.models}</div>
                  <div className="analytics-tags">
                    {insights.modelUsage.map(m => (
                      <span key={m.name} className="analytics-tag model">
                        <Bot size={12} /> {m.name} <strong>{m.count}</strong>
                      </span>
                    ))}
                  </div>
                </>
              )}

              {/* Providers */}
              {insights.providerUsage && insights.providerUsage.length > 0 && (
                <>
                  <div className="analytics-section-title">{l.providers}</div>
                  <div className="analytics-tags">
                    {insights.providerUsage.map(p => (
                      <span key={p.name} className="analytics-tag provider">
                        {p.name} <strong>{p.count}</strong>
                      </span>
                    ))}
                  </div>
                </>
              )}

              {/* Security note */}
              <div className="analytics-security">
                <Shield size={14} />
                <span>{l.security}</span>
              </div>

              {/* Clear button */}
              <button className="analytics-clear-btn" onClick={handleClear}>
                <Trash2 size={14} />
                <span>{l.clearData}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
