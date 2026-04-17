// ─── ProviderTestButton ───────────────────────────────────────────
// Tests a provider connection via listProviderModels and shows formatted
// result: spinner → "✓ 342 ms • 47 modelos" or "✗ 401 Unauthorized".

import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react'
import type { Provider } from '../../Settings'

interface TestResult {
  ok: boolean
  latencyMs: number
  modelCount?: number
  error?: string
  ts: number
}

interface ProviderTestButtonProps {
  provider: Provider
  apiKey: string
  modalHostname?: string
  customBaseUrl?: string
  disabled?: boolean
  language: 'pt' | 'en'
  onResult?: (r: TestResult) => void
  onModels?: (models: string[]) => void
}

export function ProviderTestButton({
  provider,
  apiKey,
  modalHostname,
  customBaseUrl,
  disabled,
  language,
  onResult,
  onModels,
}: ProviderTestButtonProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const run = async () => {
    setLoading(true)
    setResult(null)
    const started = performance.now()
    try {
      const res = await (window as any).electron.listProviderModels({
        provider,
        apiKey,
        modalHostname,
        customBaseUrl,
      })
      const latency = Math.round(performance.now() - started)
      if (res?.error) {
        const r: TestResult = { ok: false, latencyMs: latency, error: res.error, ts: Date.now() }
        setResult(r)
        onResult?.(r)
      } else {
        const models: string[] = res?.models ?? []
        const r: TestResult = { ok: true, latencyMs: latency, modelCount: models.length, ts: Date.now() }
        setResult(r)
        onResult?.(r)
        onModels?.(models)
      }
    } catch (e: any) {
      const latency = Math.round(performance.now() - started)
      const r: TestResult = { ok: false, latencyMs: latency, error: e?.message ?? String(e), ts: Date.now() }
      setResult(r)
      onResult?.(r)
    } finally {
      setLoading(false)
    }
  }

  const btnLabel = loading
    ? (language === 'pt' ? 'Testando…' : 'Testing…')
    : (language === 'pt' ? 'Testar conexão' : 'Test connection')

  return (
    <div className="provider-test">
      <button
        type="button"
        className="settings-fetch-btn"
        onClick={run}
        disabled={disabled || loading || !apiKey}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
        <span>{btnLabel}</span>
      </button>
      {result && !loading && (
        <span className={`provider-test-result ${result.ok ? 'ok' : 'err'}`}>
          {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span>
            {result.ok
              ? `${result.latencyMs} ms • ${result.modelCount} ${language === 'pt' ? 'modelos' : 'models'}`
              : result.error}
          </span>
        </span>
      )}
    </div>
  )
}
