import { useState } from 'react'
import { X, Check, Palette, RotateCcw } from 'lucide-react'
import { ACCENT_PRESETS } from '../hooks/useAccentColor'

interface AccentPickerProps {
  isOpen: boolean
  onClose: () => void
  value: string
  currentHex: string
  isCustom: boolean
  onPreset: (id: string) => void
  onCustomHex: (hex: string) => void
  onReset: () => void
  language?: 'pt' | 'en'
}

/**
 * Accent color picker modal (v2.11.0).
 * Eight curated presets + a custom hex field. Kept deliberately small —
 * a full HSL wheel was considered but most users want "pick a vibe,"
 * not colour theory, and the presets already cover that.
 */
export function AccentPicker({
  isOpen, onClose, value, currentHex, isCustom,
  onPreset, onCustomHex, onReset, language = 'pt',
}: AccentPickerProps) {
  const [customInput, setCustomInput] = useState(isCustom ? currentHex : '')
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const t = (pt: string, en: string) => language === 'en' ? en : pt

  const handleCustomSubmit = () => {
    const clean = customInput.trim().replace(/^#/, '')
    if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(clean)) {
      setError(t('Formato inválido. Use #RRGGBB ou #RGB.', 'Invalid format. Use #RRGGBB or #RGB.'))
      return
    }
    setError(null)
    onCustomHex(clean)
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('Cor de destaque', 'Accent color')}>
      <div className="accent-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="accent-picker-header">
          <div className="accent-picker-title">
            <Palette size={16} />
            <span>{t('Cor de destaque', 'Accent color')}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('Fechar', 'Close')}>
            <X size={16} />
          </button>
        </div>

        <div className="accent-picker-body">
          <div className="accent-picker-section-label">{t('Predefinições', 'Presets')}</div>
          <div className="accent-preset-grid">
            {ACCENT_PRESETS.map(p => {
              const active = !isCustom && value === p.id
              return (
                <button
                  key={p.id}
                  className={`accent-preset-chip ${active ? 'active' : ''}`}
                  onClick={() => onPreset(p.id)}
                  title={p.label}
                  aria-pressed={active}
                  aria-label={p.label}
                >
                  <span
                    className="accent-preset-swatch"
                    style={{ background: `linear-gradient(135deg, ${p.hex} 0%, ${p.hex2} 100%)` }}
                  />
                  <span className="accent-preset-label">{p.label}</span>
                  {active && <Check size={12} className="accent-preset-check" />}
                </button>
              )
            })}
          </div>

          <div className="accent-picker-section-label">{t('Personalizado', 'Custom')}</div>
          <div className="accent-custom-row">
            <span
              className="accent-custom-swatch"
              style={{ background: isCustom ? currentHex : 'transparent' }}
              aria-hidden="true"
            />
            <input
              type="text"
              className="accent-custom-input"
              placeholder="#3b82f6"
              value={customInput}
              onChange={(e) => { setCustomInput(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit() }}
              maxLength={7}
              aria-label={t('Cor hexadecimal personalizada', 'Custom hex color')}
            />
            <input
              type="color"
              className="accent-custom-color"
              value={isCustom ? currentHex : '#e07a5f'}
              onChange={(e) => { setCustomInput(e.target.value); onCustomHex(e.target.value) }}
              aria-label={t('Selecionar cor', 'Pick color')}
            />
            <button className="accent-custom-apply" onClick={handleCustomSubmit}>
              {t('Aplicar', 'Apply')}
            </button>
          </div>
          {error && <div className="accent-picker-error">{error}</div>}

          <button className="accent-reset-btn" onClick={onReset}>
            <RotateCcw size={12} />
            <span>{t('Restaurar padrão', 'Reset to default')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
