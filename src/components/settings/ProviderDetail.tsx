// ─── ProviderDetail ───────────────────────────────────────────────
// Right pane of the Providers tab. Renders all form fields for the
// currently selected provider by reading PROVIDERS metadata.
//
// Replaces ~180 lines of duplicated JSX that was one `{provider === 'X' && ...}`
// block per provider.

import { useState } from 'react'
import { ExternalLink, Star, Plus, Trash2 } from 'lucide-react'
import { getProviderMeta } from '../../config/providers'
import type { AppSettings, Provider, ModalKey } from '../../Settings'
import { KeyField } from './KeyField'
import { ProviderTestButton } from './ProviderTestButton'

interface ProviderDetailProps {
  providerId: Provider
  settings: AppSettings
  setSettings: (updater: (s: AppSettings) => AppSettings) => void
  /** Called when user promotes this provider to "default" (star button). */
  onMakeActive?: () => void
  /** True if this provider is the current default. */
  isActiveDefault?: boolean
  language: 'pt' | 'en'
}

const t = (language: 'pt' | 'en', pt: string, en: string) => language === 'pt' ? pt : en

export function ProviderDetail({
  providerId,
  settings,
  setSettings,
  onMakeActive,
  isActiveDefault,
  language,
}: ProviderDetailProps) {
  const meta = getProviderMeta(providerId)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])

  // Ollama has no key/model fields (local, zero-config).
  if (!meta.fields) {
    return (
      <section className="provider-detail">
        <header className="provider-detail-header">
          <div>
            <h3>{meta.label}</h3>
            <p className="provider-detail-tagline">{t(language, meta.tagline.pt, meta.tagline.en)}</p>
          </div>
          {!isActiveDefault && onMakeActive && (
            <button
              type="button"
              className="settings-fetch-btn"
              onClick={onMakeActive}
              title={t(language, 'Usar como padrão', 'Set as default')}
            >
              <Star size={14} />
              <span>{t(language, 'Usar como padrão', 'Set as default')}</span>
            </button>
          )}
          {isActiveDefault && (
            <span className="provider-detail-active-pill">
              <Star size={12} fill="currentColor" />
              {t(language, 'Provedor padrão', 'Default provider')}
            </span>
          )}
        </header>
        <p className="provider-detail-body">
          {t(
            language,
            'Ollama roda localmente — sem API key. Certifique-se de que o serviço Ollama está em execução (porta 11434).',
            'Ollama runs locally — no API key needed. Ensure the Ollama service is running (port 11434).',
          )}
        </p>
        {meta.docUrl && (
          <a
            className="provider-detail-doclink"
            href="#"
            onClick={(e) => {
              e.preventDefault()
              ;(window as any).electron?.openTarget?.(meta.docUrl)
            }}
          >
            <ExternalLink size={12} />
            <span>{t(language, 'Instalar Ollama', 'Install Ollama')}</span>
          </a>
        )}
      </section>
    )
  }

  const { apiKeySetting, modelSetting, extra } = meta.fields
  const apiKeyValue = (settings as any)[apiKeySetting] as string
  const modelValue = (settings as any)[modelSetting] as string

  const setKey = (v: string) => {
    setSettings(s => {
      const next = { ...s, [apiKeySetting]: v } as AppSettings
      // Special handling: Modal principal key syncs with first pool slot
      if (meta.id === 'modal') {
        const keys = [...(s.modalApiKeys || [])]
        if (keys.length === 0) {
          keys.push({ id: 'primary-' + Date.now(), key: v, label: 'Principal', enabled: true })
        } else {
          keys[0] = { ...keys[0], key: v }
        }
        next.modalApiKeys = keys
      }
      return next
    })
  }

  const setModel = (v: string) => {
    setSettings(s => ({ ...s, [modelSetting]: v } as AppSettings))
  }

  const setExtra = (v: string) => {
    if (!extra) return
    setSettings(s => ({ ...s, [extra.setting]: v } as AppSettings))
  }

  const datalistId = `models-${meta.id}`
  const modelOptions = fetchedModels.length > 0 ? fetchedModels : meta.defaultModels

  return (
    <section className="provider-detail">
      <header className="provider-detail-header">
        <div>
          <h3>{meta.label}</h3>
          <p className="provider-detail-tagline">{t(language, meta.tagline.pt, meta.tagline.en)}</p>
        </div>
        {!isActiveDefault && onMakeActive && apiKeyValue && (
          <button
            type="button"
            className="settings-fetch-btn"
            onClick={onMakeActive}
            title={t(language, 'Usar como padrão', 'Set as default')}
          >
            <Star size={14} />
            <span>{t(language, 'Usar como padrão', 'Set as default')}</span>
          </button>
        )}
        {isActiveDefault && (
          <span className="provider-detail-active-pill">
            <Star size={12} fill="currentColor" />
            {t(language, 'Provedor padrão', 'Default provider')}
          </span>
        )}
      </header>

      {meta.docUrl && (
        <a
          className="provider-detail-doclink"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            ;(window as any).electron?.openTarget?.(meta.docUrl)
          }}
        >
          <ExternalLink size={12} />
          <span>{t(language, 'Como obter uma key', 'How to get a key')}</span>
        </a>
      )}

      <div className="settings-group">
        <label className="settings-label"><span>API Key</span></label>
        <KeyField
          value={apiKeyValue || ''}
          onChange={setKey}
          placeholder={meta.keyPlaceholder}
          ariaLabel={`${meta.label} API key`}
        />
      </div>

      <div className="settings-group">
        <label className="settings-label"><span>{t(language, 'Modelo', 'Model')}</span></label>
        <input
          type="text"
          className="settings-input"
          list={datalistId}
          value={modelValue || ''}
          onChange={(e) => setModel(e.target.value)}
          placeholder={meta.defaultModels[0]}
        />
        <datalist id={datalistId}>
          {modelOptions.map(m => <option key={m} value={m} />)}
        </datalist>
      </div>

      {extra && (
        <div className="settings-group">
          <label className="settings-label"><span>{t(language, extra.label.pt, extra.label.en)}</span></label>
          <input
            type="text"
            className="settings-input"
            value={(settings as any)[extra.setting] as string || ''}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={extra.placeholder}
          />
        </div>
      )}

      <div className="settings-group">
        <ProviderTestButton
          provider={meta.id}
          apiKey={apiKeyValue || ''}
          modalHostname={meta.id === 'modal' ? settings.modalHostname : undefined}
          customBaseUrl={meta.id === 'custom' ? (settings as any).customBaseUrl : undefined}
          language={language}
          onModels={(models) => setFetchedModels(models)}
        />
      </div>

      {/* Modal-specific: key pool editor */}
      {meta.supportsKeyPool && meta.id === 'modal' && (
        <ModalKeyPoolEditor settings={settings} setSettings={setSettings} language={language} />
      )}
    </section>
  )
}

// ─── Modal key pool editor (inline, only used for Modal) ──────────

function ModalKeyPoolEditor({
  settings,
  setSettings,
  language,
}: {
  settings: AppSettings
  setSettings: (u: (s: AppSettings) => AppSettings) => void
  language: 'pt' | 'en'
}) {
  const keys = settings.modalApiKeys || []

  const updateKey = (id: string, patch: Partial<ModalKey>) => {
    setSettings(s => {
      const next = s.modalApiKeys.map(k => k.id === id ? { ...k, ...patch } : k)
      // Sync principal if updating first
      const primary = next[0]
      return {
        ...s,
        modalApiKeys: next,
        modalApiKey: primary?.key ?? s.modalApiKey,
      }
    })
  }

  const addKey = () => {
    setSettings(s => ({
      ...s,
      modalApiKeys: [
        ...(s.modalApiKeys || []),
        { id: 'key-' + Date.now(), key: '', label: '', enabled: true },
      ],
    }))
  }

  const removeKey = (id: string) => {
    setSettings(s => ({ ...s, modalApiKeys: s.modalApiKeys.filter(k => k.id !== id) }))
  }

  return (
    <div className="settings-group provider-pool">
      <label className="settings-label">
        <span>{t(language, 'Pool de API Keys (subagentes paralelos)', 'API Key Pool (parallel subagents)')}</span>
      </label>
      <p className="provider-pool-hint">
        {t(
          language,
          'Cada key permite 1 subagente em paralelo. A primeira key é a principal.',
          'Each key enables 1 parallel subagent. The first is the principal.',
        )}
      </p>
      {keys.map((mk, idx) => (
        <div key={mk.id} className="provider-pool-row">
          <input
            type="text"
            className="settings-input"
            value={mk.label || ''}
            placeholder={idx === 0 ? 'Principal' : `Key ${idx + 1}`}
            onChange={(e) => updateKey(mk.id, { label: e.target.value })}
            disabled={idx === 0}
            style={{ flex: '0 0 120px' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <KeyField
              value={mk.key}
              onChange={(v) => updateKey(mk.id, { key: v })}
              placeholder="modalresearch_..."
              disabled={idx === 0}
              ariaLabel={`Modal key ${idx + 1}`}
            />
          </div>
          <label className="provider-pool-toggle">
            <input
              type="checkbox"
              checked={mk.enabled}
              onChange={(e) => updateKey(mk.id, { enabled: e.target.checked })}
            />
            <span>{t(language, 'Ativa', 'On')}</span>
          </label>
          {idx > 0 && (
            <button
              type="button"
              className="mcp-server-remove"
              onClick={() => removeKey(mk.id)}
              title={t(language, 'Remover', 'Remove')}
              aria-label={t(language, 'Remover key', 'Remove key')}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="settings-fetch-btn"
        onClick={addKey}
        disabled={keys.length >= 10}
      >
        <Plus size={14} />
        <span>{t(language, 'Adicionar Key', 'Add Key')}</span>
      </button>
    </div>
  )
}
