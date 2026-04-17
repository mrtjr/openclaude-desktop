// ─── KeyField ─────────────────────────────────────────────────────
// Password input + toggle visibility + auto-trim on paste + clear button.
// Used for any secret-like field (API keys, passphrases).

import { useState, useCallback } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'

interface KeyFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function KeyField({
  value,
  onChange,
  placeholder,
  disabled,
  className = 'settings-input',
  ariaLabel,
}: KeyFieldProps) {
  const [visible, setVisible] = useState(false)

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    // Trim accidental newlines/spaces from clipboard (common paste bug)
    const pasted = e.clipboardData.getData('text')
    if (pasted && /[\n\r\s]/.test(pasted)) {
      e.preventDefault()
      onChange(pasted.trim())
    }
  }, [onChange])

  return (
    <div className="key-field">
      <input
        type={visible ? 'text' : 'password'}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
      />
      {value && !disabled && (
        <>
          <button
            type="button"
            className="key-field-btn"
            onClick={() => setVisible(v => !v)}
            title={visible ? 'Hide' : 'Show'}
            aria-label={visible ? 'Hide key' : 'Show key'}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            className="key-field-btn"
            onClick={() => onChange('')}
            title="Clear"
            aria-label="Clear key"
          >
            <X size={14} />
          </button>
        </>
      )}
    </div>
  )
}
