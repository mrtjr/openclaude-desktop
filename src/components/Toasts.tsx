import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'
import type { Toast, ToastSeverity } from '../hooks/useToast'

interface ToastsProps {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

const SEVERITY_ICON: Record<ToastSeverity, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  warn: AlertTriangle,
  error: XCircle,
}

/**
 * Toast stack — renders all active toasts in a fixed bottom-right container.
 *
 * Severity drives the accent color; errors persist until dismissed.
 * Actions (if provided) render as a secondary button inline.
 */
export default function Toasts({ toasts, onDismiss }: ToastsProps) {
  return (
    <div
      className="toast-container"
      role="region"
      aria-label="Notificações"
      aria-live="polite"
    >
      {toasts.map(t => {
        const Icon = SEVERITY_ICON[t.severity]
        return (
          <div
            key={t.id}
            className={`toast toast--${t.severity}`}
            role={t.severity === 'error' ? 'alert' : 'status'}
          >
            <Icon size={16} className="toast-icon" aria-hidden="true" />
            <div className="toast-message">{t.message}</div>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => { t.action!.onClick(); onDismiss(t.id) }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => onDismiss(t.id)}
              aria-label="Dispensar notificação"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
