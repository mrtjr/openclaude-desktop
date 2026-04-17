// ─── Account Panel ────────────────────────────────────────────────
//
// Full-screen modal with three views:
//   - Auth (sign in / sign up / Google)
//   - Passphrase unlock (for E2EE of API keys)
//   - Dashboard (session info, sync prefs, manual sync, sign out)
//
// Gracefully degrades: if Supabase isn't configured at build time,
// shows an explainer instead of auth UI.

import { useEffect, useMemo, useState } from 'react'
import { X, Mail, Lock, LogOut, RefreshCw, Shield, Cloud, AlertTriangle, Check, Eye, EyeOff } from 'lucide-react'
import type { AuthSession, SyncPreferences, SyncState } from './types/account'
import { passphraseStrength } from './services/crypto'

type View = 'auth' | 'passphrase' | 'dashboard'

interface Props {
  isOpen: boolean
  onClose: () => void
  language: 'pt' | 'en'
  configured: boolean
  session: AuthSession | null
  loading: boolean
  passphrase: string | undefined
  onSetPassphrase: (p: string | undefined) => void
  onSignInEmail: (email: string, password: string) => Promise<void>
  onSignUpEmail: (email: string, password: string) => Promise<void>
  onSignInGoogle: () => Promise<void>
  onSignOut: () => Promise<void>
  // Sync
  prefs: SyncPreferences
  onPrefsChange: (p: SyncPreferences) => void
  syncState: SyncState
  onPushNow: () => Promise<void>
  onPullNow: () => Promise<void>
}

export default function AccountPanel(props: Props) {
  const { isOpen, onClose, language, configured, session, loading, passphrase } = props
  const t = (pt: string, en: string) => (language === 'pt' ? pt : en)

  const view: View = useMemo(() => {
    if (!session) return 'auth'
    if (props.prefs.syncKeys && !passphrase) return 'passphrase'
    return 'dashboard'
  }, [session, passphrase, props.prefs.syncKeys])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal account-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('Conta & Sincronização', 'Account & Sync')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {!configured && <NotConfigured t={t} />}
        {configured && loading && <div className="account-loading">{t('Carregando…', 'Loading…')}</div>}
        {configured && !loading && view === 'auth' && <AuthView {...props} t={t} />}
        {configured && !loading && view === 'passphrase' && <PassphraseView {...props} t={t} />}
        {configured && !loading && view === 'dashboard' && <DashboardView {...props} t={t} />}
      </div>
    </div>
  )
}

// ─── Not configured ──────────────────────────────────────────────────

function NotConfigured({ t }: { t: (pt: string, en: string) => string }) {
  return (
    <div className="account-body">
      <div className="account-notice">
        <AlertTriangle size={18} />
        <div>
          <strong>{t('Sincronização não habilitada', 'Sync not enabled')}</strong>
          <p>
            {t(
              'Este build não foi compilado com credenciais Supabase. O OpenClaude funciona 100% localmente — a sincronização na nuvem é opcional.',
              'This build has no Supabase credentials. OpenClaude works fully offline — cloud sync is optional.',
            )}
          </p>
          <p style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
            {t('Veja docs/ACCOUNTS.md para configurar sua própria instância.', 'See docs/ACCOUNTS.md to configure your own instance.')}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Auth ────────────────────────────────────────────────────────────

function AuthView(props: Props & { t: (pt: string, en: string) => string }) {
  const { t, onSignInEmail, onSignUpEmail, onSignInGoogle } = props
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') await onSignInEmail(email, password)
      else await onSignUpEmail(email, password)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    setError(null)
    setBusy(true)
    try { await onSignInGoogle() } catch (e: any) { setError(e?.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="account-body">
      <div className="account-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
          {t('Entrar', 'Sign in')}
        </button>
        <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
          {t('Criar conta', 'Sign up')}
        </button>
      </div>

      <form onSubmit={submit} className="account-form">
        <label>
          <span><Mail size={14} /> Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          <span><Lock size={14} /> {t('Senha', 'Password')}</span>
          <div className="input-with-action">
            <input type={showPw ? 'text' : 'password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            <button type="button" className="icon-btn" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide' : 'Show'}>
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>

        {error && <div className="account-error"><AlertTriangle size={14} /> {error}</div>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? '…' : (mode === 'signin' ? t('Entrar', 'Sign in') : t('Criar conta', 'Sign up'))}
        </button>
      </form>

      <div className="account-divider"><span>{t('ou', 'or')}</span></div>

      <button className="btn-google" onClick={google} disabled={busy} type="button">
        <GoogleIcon /> {t('Continuar com Google', 'Continue with Google')}
      </button>

      <p className="account-hint">
        <Shield size={12} /> {t(
          'Suas chaves de API são criptografadas no dispositivo (E2EE) antes de sair daqui.',
          'Your API keys are encrypted on-device (E2EE) before leaving this machine.',
        )}
      </p>
    </div>
  )
}

// ─── Passphrase ──────────────────────────────────────────────────────

function PassphraseView(props: Props & { t: (pt: string, en: string) => string }) {
  const { t, onSetPassphrase } = props
  const [pp, setPp] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const strength = useMemo(() => passphraseStrength(pp), [pp])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isNew && pp !== confirm) return
    onSetPassphrase(pp)
  }

  return (
    <div className="account-body">
      <div className="account-notice info">
        <Shield size={18} />
        <div>
          <strong>{t('Sua frase-senha E2EE', 'Your E2EE passphrase')}</strong>
          <p>
            {t(
              'Esta frase nunca sai do seu dispositivo. É o que permite criptografar suas chaves de API antes de sincronizar. Se você esquecer, perderá acesso aos dados criptografados — não podemos recuperar.',
              'This passphrase never leaves your device. It encrypts your API keys before sync. If you forget it, encrypted data is lost — we cannot recover it.',
            )}
          </p>
        </div>
      </div>

      <div className="account-tabs" role="tablist">
        <button role="tab" aria-selected={!isNew} className={!isNew ? 'active' : ''} onClick={() => setIsNew(false)}>
          {t('Desbloquear existente', 'Unlock existing')}
        </button>
        <button role="tab" aria-selected={isNew} className={isNew ? 'active' : ''} onClick={() => setIsNew(true)}>
          {t('Criar nova', 'Create new')}
        </button>
      </div>

      <form onSubmit={submit} className="account-form">
        <label>
          <span><Lock size={14} /> {t('Frase-senha', 'Passphrase')}</span>
          <div className="input-with-action">
            <input type={show ? 'text' : 'password'} required minLength={10} value={pp} onChange={(e) => setPp(e.target.value)} />
            <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {isNew && pp && (
            <div className={`strength strength-${strength}`}>
              {strength === 'weak' && t('Fraca — mínimo 10 caracteres', 'Weak — min 10 chars')}
              {strength === 'medium' && t('Média — adicione símbolos ou comprimento', 'Medium — add symbols or length')}
              {strength === 'strong' && t('Forte', 'Strong')}
            </div>
          )}
        </label>

        {isNew && (
          <label>
            <span><Lock size={14} /> {t('Confirmar', 'Confirm')}</span>
            <input type={show ? 'text' : 'password'} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {confirm && pp !== confirm && <div className="account-error">{t('Frases não conferem', 'Passphrases do not match')}</div>}
          </label>
        )}

        <button className="btn-primary" type="submit" disabled={isNew ? (pp !== confirm || strength === 'weak') : !pp}>
          {isNew ? t('Criar e desbloquear', 'Create & unlock') : t('Desbloquear', 'Unlock')}
        </button>

        <button type="button" className="btn-subtle" onClick={() => props.onPrefsChange({ ...props.prefs, syncKeys: false })}>
          {t('Sincronizar sem chaves (desabilitar E2EE)', 'Sync without keys (disable E2EE)')}
        </button>
      </form>
    </div>
  )
}

// ─── Dashboard ──────────────────────────────────────────────────────

function DashboardView(props: Props & { t: (pt: string, en: string) => string }) {
  const { t, session, onSignOut, prefs, onPrefsChange, syncState, onPushNow, onPullNow, onSetPassphrase } = props
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null)

  const run = async (which: 'push' | 'pull') => {
    setBusy(which)
    try {
      if (which === 'push') await onPushNow()
      else await onPullNow()
    } finally { setBusy(null) }
  }

  const setPref = (k: keyof SyncPreferences, v: boolean) => onPrefsChange({ ...prefs, [k]: v })

  return (
    <div className="account-body">
      <div className="account-user">
        <div className="account-avatar">{(session!.user.email || '?')[0]?.toUpperCase()}</div>
        <div>
          <div className="account-email">{session!.user.email}</div>
          <div className="account-meta">
            {session!.user.provider === 'google' ? 'Google' : 'Email'} ·{' '}
            {new Date(session!.user.createdAt).toLocaleDateString()}
          </div>
        </div>
        <button className="btn-subtle" onClick={onSignOut} title={t('Sair', 'Sign out')}>
          <LogOut size={14} /> {t('Sair', 'Sign out')}
        </button>
      </div>

      <section className="account-section">
        <h3><Cloud size={14} /> {t('Sincronização', 'Sync')}</h3>
        <label className="toggle-row">
          <input type="checkbox" checked={prefs.enabled} onChange={(e) => setPref('enabled', e.target.checked)} />
          <span>{t('Sincronização ativada', 'Sync enabled')}</span>
        </label>

        <div className="sync-prefs-grid">
          <Pref t={t} label={[t('Configurações', 'Settings'), t('Tema, idioma, provedor default…', 'Theme, language, default provider…')]} checked={prefs.syncSettings} onChange={(v) => setPref('syncSettings', v)} disabled={!prefs.enabled} />
          <Pref t={t} label={[t('Chaves de API (E2EE)', 'API keys (E2EE)'), t('Criptografadas com sua frase-senha', 'Encrypted with your passphrase')]} checked={prefs.syncKeys} onChange={(v) => setPref('syncKeys', v)} disabled={!prefs.enabled} />
          <Pref t={t} label={[t('Perfis de agente', 'Agent profiles'), t('Personas, prompts de sistema', 'Personas, system prompts')]} checked={prefs.syncProfiles} onChange={(v) => setPref('syncProfiles', v)} disabled={!prefs.enabled} />
          <Pref t={t} label={[t('Tarefas agendadas', 'Scheduled tasks'), '']} checked={prefs.syncScheduledTasks} onChange={(v) => setPref('syncScheduledTasks', v)} disabled={!prefs.enabled} />
          <Pref t={t} label={['Personas', '']} checked={prefs.syncPersonas} onChange={(v) => setPref('syncPersonas', v)} disabled={!prefs.enabled} />
        </div>

        <div className="sync-actions">
          <button className="btn-subtle" onClick={() => run('pull')} disabled={!!busy || !prefs.enabled}>
            <RefreshCw size={14} className={busy === 'pull' ? 'spin' : ''} /> {t('Baixar', 'Pull')}
          </button>
          <button className="btn-subtle" onClick={() => run('push')} disabled={!!busy || !prefs.enabled}>
            <RefreshCw size={14} className={busy === 'push' ? 'spin' : ''} /> {t('Enviar', 'Push')}
          </button>
          <div className="sync-status">
            {syncState.status === 'idle' && syncState.lastSyncAt && (
              <><Check size={12} /> {t('Sincronizado', 'Synced')} · {new Date(syncState.lastSyncAt).toLocaleTimeString()}</>
            )}
            {syncState.status === 'syncing' && t('Sincronizando…', 'Syncing…')}
            {syncState.status === 'error' && <span className="text-danger"><AlertTriangle size={12} /> {syncState.lastError}</span>}
            {syncState.pendingChanges > 0 && syncState.status === 'idle' && (
              <span>· {syncState.pendingChanges} {t('pendentes', 'pending')}</span>
            )}
          </div>
        </div>
      </section>

      {prefs.syncKeys && (
        <section className="account-section">
          <h3><Shield size={14} /> {t('Segurança', 'Security')}</h3>
          <p className="account-hint">{t('Frase-senha E2EE desbloqueada nesta sessão.', 'E2EE passphrase unlocked this session.')}</p>
          <button className="btn-subtle" onClick={() => onSetPassphrase(undefined)}>
            {t('Bloquear (esquecer frase-senha)', 'Lock (forget passphrase)')}
          </button>
        </section>
      )}
    </div>
  )
}

function Pref({
  t, label, checked, onChange, disabled,
}: {
  t: (pt: string, en: string) => string
  label: [string, string]
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  void t
  return (
    <label className={`pref-row ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <div>
        <div className="pref-label">{label[0]}</div>
        {label[1] && <div className="pref-sub">{label[1]}</div>}
      </div>
    </label>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.2 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.2 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41 34.5 44 29.7 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  )
}
