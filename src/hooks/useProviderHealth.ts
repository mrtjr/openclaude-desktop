import { useState, useEffect, useCallback, useRef } from 'react'
import type { AppSettings, Provider } from '../types'

export type HealthStatus = 'healthy' | 'degraded' | 'down'

export interface ProviderHealthState {
  status: HealthStatus
  lastError?: string
  lastErrorTime?: number
  consecutiveErrors: number
  rateLimitUntil?: number  // timestamp when rate limit expires
}

const INITIAL_STATE: ProviderHealthState = {
  status: 'healthy',
  consecutiveErrors: 0,
}

const ERROR_THRESHOLD_DEGRADED = 2
const ERROR_THRESHOLD_DOWN = 5
const RATE_LIMIT_COOLDOWN_MS = 60_000  // 1 minute cooldown on 429
const RECOVERY_CHECK_INTERVAL = 30_000  // check recovery every 30s

export function useProviderHealth(settings: AppSettings) {
  const [healthMap, setHealthMap] = useState<Record<string, ProviderHealthState>>({})

  const currentProvider = settings.provider

  // Get health for current provider
  const currentHealth: ProviderHealthState = healthMap[currentProvider] || INITIAL_STATE

  // Report a successful request
  const reportSuccess = useCallback((provider?: string) => {
    const p = provider || currentProvider
    setHealthMap(prev => ({
      ...prev,
      [p]: { status: 'healthy', consecutiveErrors: 0 }
    }))
  }, [currentProvider])

  // Report a failed request
  const reportError = useCallback((error: string, provider?: string) => {
    const p = provider || currentProvider
    setHealthMap(prev => {
      const current = prev[p] || INITIAL_STATE
      const newErrors = current.consecutiveErrors + 1
      const isRateLimit = error.includes('429') || error.toLowerCase().includes('rate limit')

      let newStatus: HealthStatus = 'healthy'
      if (newErrors >= ERROR_THRESHOLD_DOWN) newStatus = 'down'
      else if (newErrors >= ERROR_THRESHOLD_DEGRADED || isRateLimit) newStatus = 'degraded'

      return {
        ...prev,
        [p]: {
          status: newStatus,
          lastError: error,
          lastErrorTime: Date.now(),
          consecutiveErrors: newErrors,
          rateLimitUntil: isRateLimit ? Date.now() + RATE_LIMIT_COOLDOWN_MS : current.rateLimitUntil,
        }
      }
    })
  }, [currentProvider])

  // Check if provider is rate limited
  const isRateLimited = useCallback((provider?: string): boolean => {
    const p = provider || currentProvider
    const health = healthMap[p]
    if (!health?.rateLimitUntil) return false
    return Date.now() < health.rateLimitUntil
  }, [currentProvider, healthMap])

  // Recovery check: periodically downgrade errors if no new errors
  useEffect(() => {
    const interval = setInterval(() => {
      setHealthMap(prev => {
        const updated = { ...prev }
        let changed = false
        for (const [provider, state] of Object.entries(updated)) {
          if (state.status !== 'healthy' && state.lastErrorTime) {
            const timeSinceError = Date.now() - state.lastErrorTime
            if (timeSinceError > RECOVERY_CHECK_INTERVAL * 2) {
              // Auto-recover after ~60s of no errors
              updated[provider] = { ...state, status: 'healthy', consecutiveErrors: 0 }
              changed = true
            } else if (state.status === 'down' && timeSinceError > RECOVERY_CHECK_INTERVAL) {
              updated[provider] = { ...state, status: 'degraded' }
              changed = true
            }
          }
          // Clear expired rate limits
          if (state.rateLimitUntil && Date.now() > state.rateLimitUntil) {
            updated[provider] = { ...state, rateLimitUntil: undefined }
            changed = true
          }
        }
        return changed ? updated : prev
      })
    }, RECOVERY_CHECK_INTERVAL)

    return () => clearInterval(interval)
  }, [])

  // Get configured providers (non-empty API keys)
  const getConfiguredProviders = useCallback((): Provider[] => {
    const providers: Provider[] = ['ollama']
    if (settings.openaiApiKey) providers.push('openai')
    if (settings.geminiApiKey) providers.push('gemini')
    if (settings.anthropicApiKey) providers.push('anthropic')
    if (settings.openrouterApiKey) providers.push('openrouter')
    if (settings.modalApiKey) providers.push('modal')
    return providers
  }, [settings])

  // Suggest fallback when current provider is down
  const suggestFallback = useCallback((): Provider | null => {
    if (currentHealth.status !== 'down') return null
    const configured = getConfiguredProviders()
    for (const p of configured) {
      if (p === currentProvider) continue
      const health = healthMap[p] || INITIAL_STATE
      if (health.status === 'healthy') return p
    }
    return null
  }, [currentHealth, currentProvider, healthMap, getConfiguredProviders])

  return {
    healthMap,
    currentHealth,
    reportSuccess,
    reportError,
    isRateLimited,
    suggestFallback,
    getConfiguredProviders,
  }
}
