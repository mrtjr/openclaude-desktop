import { useState } from 'react'
import { RefreshCw, ChevronDown } from 'lucide-react'
import { PROVIDER_MODEL_SUGGESTIONS } from '../constants/modelSuggestions'
import type { AppSettings } from '../Settings'

interface RegenSplitProps {
  isLoading: boolean
  settings: AppSettings
  selectedModel: string
  ollamaModels: string[]
  onRegenerate: (modelOverride?: string) => void
  /** Controlled open state — useful because App.tsx registers it in the
   *  Esc-overlay stack. Uncontrolled fallback if undefined. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Split-button for "regenerate [with another model]".
 *
 * Left half: click regenerates with the current model.
 * Right half (chevron): opens a per-provider model shortlist; selecting
 * one applies it to settings / selectedModel and dispatches regen.
 *
 * The current-model detection is provider-aware — we read from the
 * settings key matching `settings.provider` rather than reifying a
 * single "current model" string, because different providers have
 * independent last-used models.
 */
export function RegenSplit({
  isLoading, settings, selectedModel, ollamaModels,
  onRegenerate, open, onOpenChange,
}: RegenSplitProps) {
  const [localOpen, setLocalOpen] = useState(false)
  const isOpen = open ?? localOpen
  const setOpen = (v: boolean) => { onOpenChange ? onOpenChange(v) : setLocalOpen(v) }

  const isEn = settings.language === 'en'
  const prov = settings.provider
  const list = prov === 'ollama' ? ollamaModels : PROVIDER_MODEL_SUGGESTIONS[prov] || []
  const current = prov === 'ollama' ? selectedModel
    : prov === 'openai' ? settings.openaiModel
    : prov === 'anthropic' ? settings.anthropicModel
    : prov === 'gemini' ? settings.geminiModel
    : prov === 'openrouter' ? settings.openrouterModel
    : prov === 'modal' ? settings.modalModel : ''

  return (
    <div className="regen-split">
      <button
        className="titlebar-action-btn regen-main"
        onClick={() => onRegenerate()}
        title={isEn ? 'Regenerate last answer' : 'Regenerar última resposta'}
        disabled={isLoading}
      >
        <RefreshCw size={14} />
      </button>
      <button
        className="titlebar-action-btn regen-chevron"
        onClick={() => setOpen(!isOpen)}
        title={isEn ? 'Regenerate with another model' : 'Regenerar com outro modelo'}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={isLoading}
      >
        <ChevronDown size={12} />
      </button>
      {isOpen && (
        <div className="regen-menu" role="menu" onClick={e => e.stopPropagation()}>
          <div className="regen-menu-header">{isEn ? 'Regenerate with' : 'Regenerar com'}</div>
          {list.length === 0 ? (
            <div className="regen-menu-empty">{isEn ? 'No models available' : 'Sem modelos disponíveis'}</div>
          ) : list.map(m => (
            <button
              key={m}
              role="menuitem"
              className={`regen-menu-item ${m === current ? 'current' : ''}`}
              onClick={() => { setOpen(false); onRegenerate(m) }}
            >
              <span className="regen-menu-name">{m}</span>
              {m === current && (
                <span className="regen-menu-current-tag">{isEn ? 'current' : 'atual'}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
