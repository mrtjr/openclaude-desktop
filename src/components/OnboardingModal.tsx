import { useState } from 'react'
import { Bot, Check, ExternalLink, Sparkles, Loader2, ChevronRight, X } from 'lucide-react'
import type { AppSettings } from '../Settings'

type ProviderOption = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openrouter'

interface ProviderInfo {
  id: ProviderOption
  name: string
  tagline: string
  keyField: keyof AppSettings | null
  keyPlaceholder: string
  keyUrl?: string
  localOnly?: boolean
  icon: string // emoji fallback — keeps the modal lightweight
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'ollama', name: 'Ollama', tagline: '100% local, privado, zero custo', keyField: null, keyPlaceholder: '', localOnly: true, icon: '🦙' },
  { id: 'anthropic', name: 'Anthropic', tagline: 'Claude — raciocínio de ponta', keyField: 'anthropicApiKey', keyPlaceholder: 'sk-ant-...', keyUrl: 'https://console.anthropic.com/settings/keys', icon: '🅰️' },
  { id: 'openai', name: 'OpenAI', tagline: 'GPT-4o, GPT-5, o-series', keyField: 'openaiApiKey', keyPlaceholder: 'sk-proj-...', keyUrl: 'https://platform.openai.com/api-keys', icon: '🟢' },
  { id: 'gemini', name: 'Gemini', tagline: 'Google — contexto gigante', keyField: 'geminiApiKey', keyPlaceholder: 'AIza...', keyUrl: 'https://aistudio.google.com/apikey', icon: '💎' },
  { id: 'openrouter', name: 'OpenRouter', tagline: '100+ modelos, 1 API', keyField: 'openrouterApiKey', keyPlaceholder: 'sk-or-...', keyUrl: 'https://openrouter.ai/keys', icon: '🔀' },
]

type Step = 'provider' | 'key' | 'done'

interface OnboardingModalProps {
  onComplete: (updates: Partial<AppSettings>) => void
  onDismiss: () => void
}

/**
 * First-run 3-step setup. Detects absence of `oc.onboarded` flag in localStorage.
 *
 * Flow: pick provider → (if not local) paste API key with test → done.
 * Writes flag on completion or explicit skip. Never shows again.
 */
export default function OnboardingModal({ onComplete, onDismiss }: OnboardingModalProps) {
  const [step, setStep] = useState<Step>('provider')
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleProviderPick = (p: ProviderInfo) => {
    setSelectedProvider(p)
    if (p.localOnly) {
      finish(p, null)
    } else {
      setStep('key')
      setTestResult(null)
    }
  }

  const finish = (provider: ProviderInfo, key: string | null) => {
    const updates: Partial<AppSettings> = { provider: provider.id }
    if (key && provider.keyField) {
      // @ts-expect-error — dynamic assignment to the right keyField
      updates[provider.keyField] = key
    }
    localStorage.setItem('oc.onboarded', '1')
    setStep('done')
    // Brief confirmation before closing
    setTimeout(() => onComplete(updates), 700)
  }

  const testKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      // Lightweight validation: try listing models for cloud providers
      const res = await window.electron.listProviderModels({
        provider: selectedProvider.id,
        apiKey: apiKey.trim(),
      })
      if (res.error) {
        setTestResult({ ok: false, msg: res.error.length > 120 ? 'Key inválida ou sem permissão' : res.error })
      } else {
        const count = res.models?.length || 0
        setTestResult({ ok: true, msg: `Conexão OK — ${count} modelos disponíveis` })
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || 'Falha na conexão' })
    } finally {
      setTesting(false)
    }
  }

  const handleSkip = () => {
    localStorage.setItem('oc.onboarded', '1')
    onDismiss()
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-labelledby="onboarding-title" aria-modal="true">
      <div className="onboarding-modal">
        <button
          type="button"
          className="onboarding-skip"
          onClick={handleSkip}
          aria-label="Pular configuração inicial"
          title="Pular — configurar depois em Settings"
        >
          <X size={16} />
        </button>

        <div className="onboarding-header">
          <div className="onboarding-logo"><Bot size={28} /></div>
          <h2 id="onboarding-title">Bem-vindo ao OpenClaude</h2>
          <p className="onboarding-subtitle">
            {step === 'provider' && 'Escolha como quer rodar seus modelos de IA. Pode trocar depois.'}
            {step === 'key' && `Cole sua API key do ${selectedProvider?.name} para ativar.`}
            {step === 'done' && 'Tudo pronto! Vamos começar.'}
          </p>
        </div>

        {step === 'provider' && (
          <div className="onboarding-providers" role="radiogroup" aria-label="Selecionar provider">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={false}
                className="onboarding-provider-card"
                onClick={() => handleProviderPick(p)}
              >
                <div className="onboarding-provider-icon" aria-hidden="true">{p.icon}</div>
                <div className="onboarding-provider-info">
                  <div className="onboarding-provider-name">
                    {p.name}
                    {p.localOnly && <span className="onboarding-badge onboarding-badge--free">grátis</span>}
                  </div>
                  <div className="onboarding-provider-tagline">{p.tagline}</div>
                </div>
                <ChevronRight size={18} className="onboarding-provider-chevron" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        {step === 'key' && selectedProvider && (
          <div className="onboarding-key-step">
            <label className="onboarding-label" htmlFor="onb-key">
              API key do {selectedProvider.name}
            </label>
            <input
              id="onb-key"
              type="password"
              className="onboarding-input"
              autoFocus
              placeholder={selectedProvider.keyPlaceholder}
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setTestResult(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && apiKey.trim() && !testing) testKey() }}
            />
            {selectedProvider.keyUrl && (
              <a
                href={selectedProvider.keyUrl}
                onClick={e => {
                  e.preventDefault()
                  window.electron.openTarget(selectedProvider.keyUrl!).catch(() => {})
                }}
                className="onboarding-link"
              >
                Obter uma key grátis <ExternalLink size={12} />
              </a>
            )}

            {testResult && (
              <div className={`onboarding-result onboarding-result--${testResult.ok ? 'ok' : 'err'}`} role="status">
                {testResult.ok ? <Check size={14} /> : <X size={14} />}
                <span>{testResult.msg}</span>
              </div>
            )}

            <div className="onboarding-actions">
              <button type="button" className="onboarding-btn-secondary" onClick={() => { setStep('provider'); setApiKey(''); setTestResult(null) }}>
                Voltar
              </button>
              <button
                type="button"
                className="onboarding-btn-ghost"
                onClick={testKey}
                disabled={!apiKey.trim() || testing}
              >
                {testing ? <><Loader2 size={14} className="spin" /> Testando</> : 'Testar'}
              </button>
              <button
                type="button"
                className="onboarding-btn-primary"
                onClick={() => finish(selectedProvider, apiKey.trim())}
                disabled={!apiKey.trim()}
              >
                Continuar <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="onboarding-done">
            <div className="onboarding-done-icon"><Sparkles size={36} /></div>
            <div className="onboarding-done-msg">
              {selectedProvider?.localOnly
                ? 'Ollama detectado — certifique-se de que está rodando em localhost:11434.'
                : `${selectedProvider?.name} configurado. Você pode adicionar mais providers em Settings.`}
            </div>
          </div>
        )}

        <div className="onboarding-footer">
          <span className="onboarding-step-indicator">
            {step === 'provider' && '1 / 2'}
            {step === 'key' && '2 / 2'}
            {step === 'done' && <><Check size={12} /> Pronto</>}
          </span>
          {step !== 'done' && (
            <button type="button" className="onboarding-skip-link" onClick={handleSkip}>
              Pular e configurar depois
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
