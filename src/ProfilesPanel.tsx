import { useState } from 'react'
import { X, Plus, Edit3, Trash2, Check, Copy, Shield, Thermometer, Server, Brain, Save, RotateCcw } from 'lucide-react'
import type { AgentProfile } from './types/profile'
import type { Provider, PermissionLevel } from './Settings'

interface ProfilesPanelProps {
  isOpen: boolean
  onClose: () => void
  allProfiles: AgentProfile[]
  activeProfileId: string | null
  onActivate: (id: string | null) => void
  onCreate: (profile: Omit<AgentProfile, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>) => void
  onUpdate: (id: string, changes: Partial<AgentProfile>) => void
  onRemove: (id: string) => void
  onDuplicate: (id: string) => void
  language: 'pt' | 'en'
}

const PROVIDERS: Provider[] = ['ollama', 'openai', 'gemini', 'anthropic', 'openrouter', 'modal']
const PERMISSIONS: PermissionLevel[] = ['ask', 'auto_edits', 'planning', 'ignore']

const EMPTY_FORM = {
  name: '',
  icon: '🤖',
  description: '',
  systemPrompt: '',
  provider: '' as string,
  model: '',
  temperature: '' as string | number,
  maxTokens: '' as string | number,
  permissionLevel: '' as string,
}

export default function ProfilesPanel(props: ProfilesPanelProps) {
  const { isOpen, onClose, allProfiles, activeProfileId, onActivate, onCreate, onUpdate, onRemove, onDuplicate, language } = props
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

  const startEdit = (p: AgentProfile) => {
    setEditingId(p.id)
    setShowForm(true)
    setForm({
      name: p.name,
      icon: p.icon,
      description: p.description,
      systemPrompt: p.systemPrompt || '',
      provider: p.provider || '',
      model: p.model || '',
      temperature: p.temperature ?? '',
      maxTokens: p.maxTokens ?? '',
      permissionLevel: p.permissionLevel || '',
    })
  }

  const handleSave = () => {
    if (!form.name.trim()) return
    const data = {
      name: form.name.trim(),
      icon: form.icon || '🤖',
      description: form.description.trim(),
      systemPrompt: form.systemPrompt.trim() || undefined,
      provider: (form.provider || undefined) as Provider | undefined,
      model: form.model.trim() || undefined,
      temperature: form.temperature !== '' ? Number(form.temperature) : undefined,
      maxTokens: form.maxTokens !== '' ? Number(form.maxTokens) : undefined,
      permissionLevel: (form.permissionLevel || undefined) as PermissionLevel | undefined,
    }

    if (editingId) {
      onUpdate(editingId, data)
    } else {
      onCreate(data)
    }
    resetForm()
  }

  const getOverrideBadges = (p: AgentProfile) => {
    const badges: string[] = []
    if (p.provider) badges.push(p.provider)
    if (p.temperature !== undefined) badges.push(`temp ${p.temperature}`)
    if (p.permissionLevel) badges.push(p.permissionLevel)
    if (p.maxTokens) badges.push(`${p.maxTokens} tokens`)
    if (p.model) badges.push(p.model.length > 20 ? p.model.slice(0, 18) + '…' : p.model)
    return badges
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="profiles-panel" onClick={e => e.stopPropagation()}>
        <div className="profiles-header">
          <div className="profiles-title">
            <Brain size={18} />
            <h2>{t('Perfis de Agente', 'Agent Profiles')}</h2>
          </div>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <p className="profiles-subtitle">
          {t(
            'Perfis aplicam overrides de configuração por conversa — provider, modelo, temperatura, prompt e permissões.',
            'Profiles apply per-conversation config overrides — provider, model, temperature, prompt, and permissions.'
          )}
        </p>

        {/* Active indicator */}
        {activeProfileId && (
          <div className="profiles-active-bar">
            <span>{t('Ativo:', 'Active:')} {allProfiles.find(p => p.id === activeProfileId)?.icon} {allProfiles.find(p => p.id === activeProfileId)?.name}</span>
            <button className="profiles-deactivate" onClick={() => onActivate(null)}>
              <RotateCcw size={12} /> {t('Desativar', 'Deactivate')}
            </button>
          </div>
        )}

        {/* Profile list */}
        <div className="profiles-list">
          {allProfiles.map(p => (
            <div
              key={p.id}
              className={`profile-card ${activeProfileId === p.id ? 'active' : ''}`}
              onClick={() => onActivate(activeProfileId === p.id ? null : p.id)}
            >
              <div className="profile-card-left">
                <span className="profile-icon">{p.icon}</span>
                <div className="profile-info">
                  <div className="profile-name">
                    {p.name}
                    {p.isBuiltIn && <span className="profile-builtin-badge">{t('padrão', 'built-in')}</span>}
                  </div>
                  <div className="profile-desc">{p.description}</div>
                  {getOverrideBadges(p).length > 0 && (
                    <div className="profile-badges">
                      {getOverrideBadges(p).map((b, i) => (
                        <span key={i} className="profile-badge">{b}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="profile-card-actions" onClick={e => e.stopPropagation()}>
                {activeProfileId === p.id && <Check size={16} className="profile-check" />}
                <button className="profile-action-btn" onClick={() => onDuplicate(p.id)} title={t('Duplicar', 'Duplicate')}>
                  <Copy size={14} />
                </button>
                {!p.isBuiltIn && (
                  <>
                    <button className="profile-action-btn" onClick={() => startEdit(p)} title={t('Editar', 'Edit')}>
                      <Edit3 size={14} />
                    </button>
                    <button className="profile-action-btn danger" onClick={() => onRemove(p.id)} title={t('Excluir', 'Delete')}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* New / Edit form */}
        {showForm ? (
          <div className="profile-form">
            <h3>{editingId ? t('Editar Perfil', 'Edit Profile') : t('Novo Perfil', 'New Profile')}</h3>
            <div className="profile-form-row">
              <input className="profile-form-icon" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="🤖" maxLength={4} />
              <input className="profile-form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('Nome do perfil', 'Profile name')} />
            </div>
            <input className="profile-form-input full" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('Descrição curta', 'Short description')} />
            <textarea className="profile-form-textarea" value={form.systemPrompt} onChange={e => setForm({ ...form, systemPrompt: e.target.value })} placeholder={t('System prompt (opcional)', 'System prompt (optional)')} rows={3} />
            <div className="profile-form-grid">
              <div className="profile-form-field">
                <label><Server size={12} /> Provider</label>
                <select value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}>
                  <option value="">{t('Herdar global', 'Inherit global')}</option>
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="profile-form-field">
                <label><Thermometer size={12} /> {t('Temperatura', 'Temperature')}</label>
                <input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={e => setForm({ ...form, temperature: e.target.value })} placeholder="—" />
              </div>
              <div className="profile-form-field">
                <label><Shield size={12} /> {t('Permissão', 'Permission')}</label>
                <select value={form.permissionLevel} onChange={e => setForm({ ...form, permissionLevel: e.target.value })}>
                  <option value="">{t('Herdar global', 'Inherit global')}</option>
                  {PERMISSIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <input className="profile-form-input full" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder={t('Modelo (opcional, ex: gpt-4o)', 'Model (optional, e.g. gpt-4o)')} />
            <div className="profile-form-actions">
              <button className="profile-btn cancel" onClick={resetForm}>{t('Cancelar', 'Cancel')}</button>
              <button className="profile-btn save" onClick={handleSave} disabled={!form.name.trim()}>
                <Save size={14} /> {editingId ? t('Salvar', 'Save') : t('Criar', 'Create')}
              </button>
            </div>
          </div>
        ) : (
          <button className="profile-add-btn" onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus size={16} /> {t('Criar Perfil', 'Create Profile')}
          </button>
        )}
      </div>
    </div>
  )
}
