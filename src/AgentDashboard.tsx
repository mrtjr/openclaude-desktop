// ─── Agent Dashboard ────────────────────────────────────────────────
// Unified ops view (v2.12.0, Paperclip-inspired).
//
// The app already ships Personas, Scheduled Tasks, Workflows, Analytics
// and Provider Health — each in its own panel. That fragmentation hid
// the "big picture": how much have I spent today? Which schedulers are
// about to fire? Is OpenAI healthy? Which persona is pinned?
//
// This panel is the single glance that answers those questions without
// switching features. It's read-mostly — every card has a quick-action
// to open the specialized panel for deeper edits.
//
// Keep it lean: no heavy charts (Analytics owns those), no CRUD forms.

import { useEffect, useState, useMemo } from 'react'
import {
  X, Activity, UserCog, Clock, DollarSign, Zap, ShieldCheck,
  CircleDot, CheckCircle2, PlayCircle, PauseCircle,
  TrendingUp, ArrowRight,
} from 'lucide-react'
import type { AppSettings, Provider } from './types'
import type { Persona } from './PersonaEngine'
import type { ScheduledTask } from './types/schedule'
import type { ProviderHealthState } from './hooks/useProviderHealth'
import { formatCost } from './constants/pricing'

export interface AgentDashboardProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  language: 'pt' | 'en'

  // Personas
  activePersona: Persona | null
  onOpenPersonas: () => void

  // Scheduled tasks
  scheduledTasks: ScheduledTask[]
  onOpenScheduler: () => void
  onRunTaskNow: (id: string) => void
  onToggleTask: (id: string) => void

  // Usage
  todayCost: number
  monthCost: number
  monthEntries: number

  // Provider health
  healthMap: Record<string, ProviderHealthState>
  configuredProviders: Provider[]
  onOpenSettings: () => void

  // Agent mode
  isAgentMode: boolean
  onToggleAgentMode: () => void

  // Workflows (optional — just a shortcut link)
  onOpenWorkflows: () => void
  onOpenAnalytics: () => void
}

const T = {
  pt: {
    title: 'Painel do Agente',
    subtitle: 'Visão unificada das suas operações',
    close: 'Fechar',
    today: 'Hoje',
    month: '30 dias',
    requests: 'requisições',
    persona: 'Persona ativa',
    noPersona: 'Nenhuma selecionada',
    manage: 'Gerenciar',
    scheduler: 'Agendador',
    tasksActive: 'ativas',
    tasksInactive: 'pausadas',
    nextRun: 'Próxima',
    runNow: 'Rodar agora',
    spending: 'Gastos',
    providers: 'Provedores',
    healthy: 'saudável',
    degraded: 'instável',
    down: 'fora do ar',
    agentMode: 'Modo Agente',
    agentOn: 'ativo',
    agentOff: 'desativado',
    noScheduled: 'Nenhuma tarefa agendada',
    createTask: 'Criar tarefa',
    openWorkflows: 'Workflows',
    openAnalytics: 'Analytics detalhado',
    openPersonas: 'Biblioteca de personas',
    toggleAgent: 'Ativar/desativar',
    upcoming: 'Próximas execuções',
    none: '—',
  },
  en: {
    title: 'Agent Dashboard',
    subtitle: 'Unified view of your operations',
    close: 'Close',
    today: 'Today',
    month: '30 days',
    requests: 'requests',
    persona: 'Active persona',
    noPersona: 'None selected',
    manage: 'Manage',
    scheduler: 'Scheduler',
    tasksActive: 'active',
    tasksInactive: 'paused',
    nextRun: 'Next',
    runNow: 'Run now',
    spending: 'Spending',
    providers: 'Providers',
    healthy: 'healthy',
    degraded: 'degraded',
    down: 'down',
    agentMode: 'Agent Mode',
    agentOn: 'on',
    agentOff: 'off',
    noScheduled: 'No scheduled tasks',
    createTask: 'Create task',
    openWorkflows: 'Workflows',
    openAnalytics: 'Detailed analytics',
    openPersonas: 'Persona library',
    toggleAgent: 'Toggle',
    upcoming: 'Upcoming runs',
    none: '—',
  },
}

function relativeTime(ms: number | undefined, lang: 'pt' | 'en'): string {
  if (!ms) return '—'
  const diff = ms - Date.now()
  const abs = Math.abs(diff)
  const past = diff < 0
  const mins = Math.floor(abs / 60000)
  if (mins < 1) return lang === 'pt' ? 'agora' : 'now'
  if (mins < 60) return past
    ? (lang === 'pt' ? `há ${mins}min` : `${mins}m ago`)
    : (lang === 'pt' ? `em ${mins}min` : `in ${mins}m`)
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return past
    ? (lang === 'pt' ? `há ${hrs}h` : `${hrs}h ago`)
    : (lang === 'pt' ? `em ${hrs}h` : `in ${hrs}h`)
  const days = Math.floor(hrs / 24)
  return past
    ? (lang === 'pt' ? `há ${days}d` : `${days}d ago`)
    : (lang === 'pt' ? `em ${days}d` : `in ${days}d`)
}

function HealthDot({ status }: { status: 'healthy' | 'degraded' | 'down' }) {
  return <span className={`ad-dot ad-dot-${status}`} aria-hidden="true" />
}

export default function AgentDashboard(props: AgentDashboardProps) {
  const { isOpen, onClose, language: lang } = props
  const t = T[lang]

  // Live clock for nextRun relative times. Re-renders every 30s so the
  // "em 5min" countdown updates without needing props to change.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isOpen) return
    const id = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [isOpen])

  // Next 5 upcoming task runs (enabled tasks only, sorted by nextRun asc).
  const upcoming = useMemo(() => {
    return [...props.scheduledTasks]
      .filter(tk => tk.enabled && tk.nextRun)
      .sort((a, b) => (a.nextRun! - b.nextRun!))
      .slice(0, 5)
  }, [props.scheduledTasks])

  const activeTasks = props.scheduledTasks.filter(t => t.enabled).length
  const inactiveTasks = props.scheduledTasks.length - activeTasks

  if (!isOpen) return null

  return (
    <div className="analytics-overlay ad-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
      <div
        className="analytics-modal ad-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
      >
        <div className="analytics-header ad-header">
          <div className="ad-header-title">
            <Activity size={20} className="ad-header-icon" />
            <div>
              <h2>{t.title}</h2>
              <p className="ad-header-sub">{t.subtitle}</p>
            </div>
          </div>
          <button className="analytics-close-btn" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <div className="ad-body">
          {/* Row 1: headline KPIs ─────────────────────────────── */}
          <div className="ad-kpi-row">
            <div className="ad-kpi">
              <div className="ad-kpi-icon" style={{ background: 'var(--accent-soft)' }}>
                <DollarSign size={16} />
              </div>
              <div className="ad-kpi-body">
                <div className="ad-kpi-label">{t.today}</div>
                <div className="ad-kpi-value">{formatCost(props.todayCost)}</div>
              </div>
            </div>

            <div className="ad-kpi">
              <div className="ad-kpi-icon" style={{ background: 'rgba(155, 93, 229, 0.15)' }}>
                <TrendingUp size={16} />
              </div>
              <div className="ad-kpi-body">
                <div className="ad-kpi-label">{t.month}</div>
                <div className="ad-kpi-value">{formatCost(props.monthCost)}</div>
                <div className="ad-kpi-sub">{props.monthEntries} {t.requests}</div>
              </div>
            </div>

            <div className="ad-kpi">
              <div className="ad-kpi-icon" style={{ background: 'rgba(45, 212, 191, 0.15)' }}>
                <Clock size={16} />
              </div>
              <div className="ad-kpi-body">
                <div className="ad-kpi-label">{t.scheduler}</div>
                <div className="ad-kpi-value">{activeTasks}</div>
                <div className="ad-kpi-sub">{activeTasks} {t.tasksActive} · {inactiveTasks} {t.tasksInactive}</div>
              </div>
            </div>

            <button
              className={`ad-kpi ad-kpi-action ${props.isAgentMode ? 'ad-kpi-active' : ''}`}
              onClick={props.onToggleAgentMode}
              aria-pressed={props.isAgentMode}
            >
              <div className="ad-kpi-icon" style={{ background: props.isAgentMode ? 'rgba(234, 179, 8, 0.2)' : 'var(--border-soft)' }}>
                <Zap size={16} />
              </div>
              <div className="ad-kpi-body">
                <div className="ad-kpi-label">{t.agentMode}</div>
                <div className="ad-kpi-value">{props.isAgentMode ? t.agentOn : t.agentOff}</div>
                <div className="ad-kpi-sub">{t.toggleAgent}</div>
              </div>
            </button>
          </div>

          {/* Row 2: personas + providers ──────────────────────── */}
          <div className="ad-grid-2">
            <div className="ad-card">
              <div className="ad-card-head">
                <div className="ad-card-title"><UserCog size={14} /> {t.persona}</div>
                <button className="ad-card-link" onClick={props.onOpenPersonas}>
                  {t.openPersonas} <ArrowRight size={12} />
                </button>
              </div>
              <div className="ad-persona-body">
                {props.activePersona ? (
                  <>
                    <div className="ad-persona-avatar">{props.activePersona.emoji ?? '🤖'}</div>
                    <div className="ad-persona-meta">
                      <div className="ad-persona-name">{props.activePersona.name}</div>
                      {props.activePersona.description && (
                        <div className="ad-persona-desc">{props.activePersona.description}</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="ad-muted">{t.noPersona}</div>
                )}
              </div>
            </div>

            <div className="ad-card">
              <div className="ad-card-head">
                <div className="ad-card-title"><ShieldCheck size={14} /> {t.providers}</div>
                <button className="ad-card-link" onClick={props.onOpenSettings}>
                  {t.manage} <ArrowRight size={12} />
                </button>
              </div>
              <div className="ad-providers">
                {props.configuredProviders.map(p => {
                  const h = props.healthMap[p]
                  const status = h?.status ?? 'healthy'
                  return (
                    <div key={p} className="ad-provider-row">
                      <HealthDot status={status} />
                      <span className="ad-provider-name">{p}</span>
                      <span className={`ad-provider-status ad-status-${status}`}>{t[status]}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Row 3: upcoming scheduled runs ───────────────────── */}
          <div className="ad-card">
            <div className="ad-card-head">
              <div className="ad-card-title"><Clock size={14} /> {t.upcoming}</div>
              <button className="ad-card-link" onClick={props.onOpenScheduler}>
                {t.scheduler} <ArrowRight size={12} />
              </button>
            </div>
            {upcoming.length === 0 ? (
              <div className="ad-empty">
                <CircleDot size={14} /> {t.noScheduled}
              </div>
            ) : (
              <div className="ad-task-list">
                {upcoming.map(task => (
                  <div key={task.id} className="ad-task-row">
                    <div className="ad-task-info">
                      <div className="ad-task-name">
                        {task.enabled ? <CheckCircle2 size={12} className="ad-task-enabled" /> : <PauseCircle size={12} className="ad-muted" />}
                        {task.name || task.prompt.slice(0, 60)}
                      </div>
                      <div className="ad-task-meta">
                        {t.nextRun}: {relativeTime(task.nextRun, lang)}
                      </div>
                    </div>
                    <div className="ad-task-actions">
                      <button
                        className="ad-task-btn"
                        onClick={() => props.onRunTaskNow(task.id)}
                        title={t.runNow}
                        aria-label={t.runNow}
                      >
                        <PlayCircle size={14} />
                      </button>
                      <button
                        className="ad-task-btn"
                        onClick={() => props.onToggleTask(task.id)}
                        title={t.toggleAgent}
                        aria-label={t.toggleAgent}
                      >
                        {task.enabled ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row 4: secondary shortcuts ───────────────────────── */}
          <div className="ad-shortcuts">
            <button className="ad-shortcut" onClick={props.onOpenWorkflows}>
              {t.openWorkflows} <ArrowRight size={12} />
            </button>
            <button className="ad-shortcut" onClick={props.onOpenAnalytics}>
              {t.openAnalytics} <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
