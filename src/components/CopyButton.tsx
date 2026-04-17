import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyButtonProps {
  /** Text to copy (markdown preserved). */
  text: string
  /** Tooltip label before click. */
  title?: string
  /** Icon size in px (default 12). */
  size?: number
  /** className for the button. */
  className?: string
  /** Called after successful copy (e.g. show toast). */
  onCopied?: () => void
}

/**
 * Self-contained copy-to-clipboard button with a 1.5s check feedback.
 * Preserves markdown formatting (copies raw text as-is).
 */
export default function CopyButton({
  text,
  title = 'Copiar como Markdown',
  size = 12,
  className = 'msg-action-btn',
  onCopied,
}: CopyButtonProps) {
  const [justCopied, setJustCopied] = useState(false)

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setJustCopied(true)
      onCopied?.()
      setTimeout(() => setJustCopied(false), 1500)
    } catch {
      // fallback: try old API (sync)
      try { document.execCommand('copy') } catch { /* ignore */ }
    }
  }, [text, onCopied])

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      title={title}
      aria-label={justCopied ? 'Copiado' : title}
    >
      {justCopied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  )
}
