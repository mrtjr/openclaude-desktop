import { useState } from 'react'
import { X, Plus, Edit3, Trash2, Play, Pause, Clock, Calendar, Timer, Save, Zap } from 'lucide-react'
import type { ScheduledTask, ScheduleType, TaskSchedule } from './types/schedule'
import type { AgentProfile } from './types/profile'

interface ScheduledTasksPanelProps {
  isOpen: boolean
  onClose: () => void
  tasks: ScheduledTask[]
  onCreate: (task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'createdConversationIds' | 'nextRun'>) => void
  onUpdate: (id: string, changes: Partial<ScheduledTask>) => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
  onRunNow: (id: string) => void
  profiles: AgentProfile[]
  language: 'pt' | 'en'
}

const DAYS = {
  pt: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

const EMPTY_FORM = {
  name: '',
  prompt: '',
  scheduleType: 'daily' as ScheduleType,
  intervalMinutes: 60,
  time: '09:00',
  dayOfWeek: 1,
  profileId: '',
  enabled: true,
}

export default function ScheduledTasksPanel(props: ScheduledTasksPanelProps) {
  const { isOpen, onClose, tasks, onCreate, onUpdate, onRemove, onToggle, onRunNow, profiles, language } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  if (!isOpen) return null

  const t = (pt: string, en: string) => language === 'pt' ? pt : en

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setShowForm(false)
    setEditingId(null)
  }

  const startEdit = (task: ScheduledTask) => {
    setEditingId(task.id)
    setShowForm(true)
    setForm({
      name: task.name,
      prompt: task.prompt,
      scheduleType: task.schedule.type,
      intervalMinutes: task.schedule.intervalMinutes ?? 60,
      time: task.schedule.time ?? '09:00',
      dayOfWeek: task.schedule.dayOfWeek ?? 1,
      profileId: task.profileId ?? '',
      enabled: task.enabled,
    })
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.prompt.trim()) return
    const schedule: TaskSchedule = {
      type: form.scheduleType,
      ...(form.scheduleType === 'interval' && { intervalMinutes: form.intervalMinutes }),
      ...(form.scheduleType !== 'interval' && { time: form.time }),
      ...(form.scheduleType === 'weekly' && { dayOfWeek: form.dayOfWeek }),
    }
    const data = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      schedule,
      profileId: form.profileId || undefined,
      enabled: form.enabled,
    }

    if (editingId) {
      onUpdate(editingId, data)
    } else {
      onCreate(data)
    }
    resetForm()
  }

  const formatSchedule = (task: ScheduledTask): string => {
    const s = task.schedule
    if (s.type === 'interval') {
      const mins = s.intervalMinutes ?? 60
      if (mins >= 60) return t(`A cada ${mins / 60}h`, `Every ${mins / 60}h`)
      return t(`A cada ${mins}min`, `Every ${mins}min`)
    }
    if (s.type === 'daily') return t(`Diário às ${s.time}`, `Daily at ${s.time}`)
    if (s.type === 'weekly') {
      const day = DAYS[language][s.dayOfWeek ?? 1]
      return t(`${day} às ${s.time}`, `${day} at ${s.time}`)
    }
    return '—'
  }

  const formatRelative = (epoch?: number): string => {
    if (!epoch) return '—'
    const diff = epoch - Date.now()
    if (diff < 0) return t('agora', 'now')
    const mins = Math.floor(diff / 60_000)
    if (mins < 60) return t(`em ${mins}min`, `in ${mins}min`)
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return t(`em ${hrs}h`, `in ${hrs}h`)
    return t(`em ${Math.floor(hrs / 24)}d`, `in ${Math.floor(hrs / 24)}d`)
  }

  const formatLastRun = (epoch?: number): string => {
    if (!epoch) return t('Nunca executou', 'Never ran')
    const diff = Date.now() - epoch
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return t('Agora mesmo', 'Just now')
    if (mins < 60) return t(`${mins}min atrás`, `${mins}min ago`)
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return t(`${hrs}h atrás`, `${hrs}h ago`)
    return t(`${Math.floor(hrs / 24)}d atrás`, `${Math.floor(hrs / 24)}d ago`)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="scheduled-panel" onClick={e => e.stopPropagation()}>
        <div className="scheduled-header">
          <div className="scheduled-title">
            <Clock size={18} />
            <h2>{t('Tarefas Agendadas', 'Scheduled Tasks')}</h2>
            {tasks.filter(tk => tk.enabled).length > 0 && (
              <span className="scheduled-count">{tasks.filter(tk => tk.enabled).length} {t('ativas', 'active')}</span>
            )}
          </div>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <p className="scheduled-subtitle">
          {t(
            'Agende prompts automáticos — relatórios diários, verificações periódicas, lembretes recorrentes.',
            'Schedule automatic prompts — daily reports, periodic checks, recurring reminders.'
          )}
        </p>

        {/* Task list */}
        {tasks.length === 0 ? (
          <div className="scheduled-empty">
            <Timer size={32} />
            <p>{t('Nenhuma tarefa agendada ainda.', 'No scheduled tasks yet.')}</p>
          </div>
        ) : (
          <div className="scheduled-list">
            {tasks.map(task => (
              <div key={task.id} className={`task-card ${!task.enabled ? 'disabled' : ''}`}>
                <div className="task-card-top">
                  <div className="task-card-info">
                    <div className="task-name">{task.name}</div>
                    <div className="task-schedule">
                      <Calendar size={11} /> {formatSchedule(task)}
                      {task.profileId && (
                        <span className="task-profile-badge">
                          {profiles.find(p => p.id === task.profileId)?.icon} {profiles.find(p => p.id === task.profileId)?.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="task-card-actions">
                    <button className="task-action-btn" onClick={() => onRunNow(task.id)} title={t('Executar agora', 'Run now')}>
                      <Play size={14} />
                    </button>
                    <button className={`task-action-btn ${task.enabled ? 'on' : ''}`} onClick={() => onToggle(task.id)} title={task.enabled ? t('Pausar', 'Pause') : t('Ativar', 'Enable')}>
                      {task.enabled ? <Pause size={14} /> : <Zap size={14} />}
                    </button>
                    <button className="task-action-btn" onClick={() => startEdit(task)} title={t('Editar', 'Edit')}>
                      <Edit3 size={14} />
                    </button>
                    <button className="task-action-btn danger" onClick={() => onRemove(task.id)} title={t('Excluir', 'Delete')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="task-card-bottom">
                  <span className="task-prompt-preview">{task.prompt.length > 80 ? task.prompt.slice(0, 78) + '…' : task.prompt}</span>
                  <div className="task-timing">
                    <span>{t('Último:', 'Last:')} {formatLastRun(task.lastRun)}</span>
                    {task.enabled && task.nextRun && <span>{t('Próximo:', 'Next:')} {formatRelative(task.nextRun)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create / Edit form */}
        {showForm ? (
          <div className="task-form">
            <h3>{editingId ? t('Editar Tarefa', 'Edit Task') : t('Nova Tarefa', 'New Task')}</h3>
            <input className="task-form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('Nome da tarefa', 'Task name')} />
            <textarea className="task-form-textarea" value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder={t('Prompt que será enviado automaticamente…', 'Prompt to send automatically…')} rows={3} />

            <div className="task-form-schedule">
              <div className="task-form-field">
                <label><Clock size={12} /> {t('Frequência', 'Frequency')}</label>
                <select value={form.scheduleType} onChange={e => setForm({ ...form, scheduleType: e.target.value as ScheduleType })}>
                  <option value="interval">{t('Intervalo', 'Interval')}</option>
                  <option value="daily">{t('Diário', 'Daily')}</option>
                  <option value="weekly">{t('Semanal', 'Weekly')}</option>
                </select>
              </div>

              {form.scheduleType === 'interval' && (
                <div className="task-form-field">
                  <label><Timer size={12} /> {t('Minutos', 'Minutes')}</label>
                  <input type="number" min={5} max={1440} value={form.intervalMinutes} onChange={e => setForm({ ...form, intervalMinutes: Number(e.target.value) })} />
                </div>
              )}

              {form.scheduleType !== 'interval' && (
                <div className="task-form-field">
                  <label><Clock size={12} /> {t('Horário', 'Time')}</label>
                  <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
                </div>
              )}

              {form.scheduleType === 'weekly' && (
                <div className="task-form-field">
                  <label><Calendar size={12} /> {t('Dia', 'Day')}</label>
                  <select value={form.dayOfWeek} onChange={e => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
                    {DAYS[language].map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}
            </div>

            {profiles.length > 0 && (
              <div className="task-form-field full">
                <label>{t('Perfil de Agente', 'Agent Profile')}</label>
                <select value={form.profileId} onChange={e => setForm({ ...form, profileId: e.target.value })}>
                  <option value="">{t('Nenhum (usar global)', 'None (use global)')}</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
                </select>
              </div>
            )}

            <div className="task-form-actions">
              <button className="task-btn cancel" onClick={resetForm}>{t('Cancelar', 'Cancel')}</button>
              <button className="task-btn save" onClick={handleSave} disabled={!form.name.trim() || !form.prompt.trim()}>
                <Save size={14} /> {editingId ? t('Salvar', 'Save') : t('Criar', 'Create')}
              </button>
            </div>
          </div>
        ) : (
          <button className="task-add-btn" onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus size={16} /> {t('Criar Tarefa', 'Create Task')}
          </button>
        )}
      </div>
    </div>
  )
}
