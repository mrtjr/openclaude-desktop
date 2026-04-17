// ─── ProviderList ─────────────────────────────────────────────────
// Left sidebar of the Providers tab. Vertical list of providers with a
// health dot (color-coded), label, tagline, and an active indicator.
//
// Status priority:
//   unconfigured (grey)  — no API key set (and not Ollama)
//   healthy (green)      — configured, no recent errors
//   degraded (yellow)    — recent errors or in cooldown
//   down (red)           — 3+ consecutive errors

import { PROVIDERS, type ProviderMeta } from '../../config/providers'
import type { AppSettings, Provider } from '../../Settings'
import type { HealthStatus } from '../../hooks/useProviderHealth'

export type ProviderVisualStatus = HealthStatus | 'unconfigured'

function computeStatus(
  meta: ProviderMeta,
  settings: AppSettings,
  health: HealthStatus | undefined,
): ProviderVisualStatus {
  // Ollama doesn't need a key — always considered configured
  if (meta.id === 'ollama') return health ?? 'healthy'
  if (!meta.fields) return 'unconfigured'
  const keyValue = (settings as any)[meta.fields.apiKeySetting] as string | undefined
  if (!keyValue || !keyValue.trim()) return 'unconfigured'
  return health ?? 'healthy'
}

const STATUS_DOT: Record<ProviderVisualStatus, string> = {
  healthy: '#10b981',
  degraded: '#f59e0b',
  down: '#ef4444',
  unconfigured: '#64748b',
}

interface ProviderListProps {
  settings: AppSettings
  selectedId: Provider
  onSelect: (id: Provider) => void
  /** Map of provider id → current health status (from useProviderHealth). */
  healthMap?: Partial<Record<Provider, HealthStatus>>
  /** The provider currently set as default in AppSettings. */
  activeProviderId: Provider
}

export function ProviderList({
  settings,
  selectedId,
  onSelect,
  healthMap = {},
  activeProviderId,
}: ProviderListProps) {
  return (
    <nav className="provider-list" aria-label="Providers">
      {PROVIDERS.map(meta => {
        const status = computeStatus(meta, settings, healthMap[meta.id])
        const isSelected = meta.id === selectedId
        const isActive = meta.id === activeProviderId
        const keyCount = meta.id === 'modal' && settings.modalApiKeys
          ? settings.modalApiKeys.filter(k => k.enabled && k.key).length
          : 0
        return (
          <button
            key={meta.id}
            type="button"
            className={`provider-list-item ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelect(meta.id)}
            aria-current={isSelected ? 'true' : undefined}
            title={meta.tagline.en}
          >
            <span
              className="provider-dot"
              style={{ backgroundColor: STATUS_DOT[status] }}
              aria-label={status}
              title={status}
            />
            <span className="provider-list-body">
              <span className="provider-list-label">
                {meta.label}
                {isActive && <span className="provider-list-active-badge" title="Active provider">●</span>}
                {keyCount > 1 && (
                  <span className="provider-list-pool-badge" title={`${keyCount} keys in pool`}>
                    {keyCount}
                  </span>
                )}
              </span>
              <span className="provider-list-tagline">{meta.tagline.pt}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
