import { useCallback, useState } from 'react'

export type ToastSeverity = 'info' | 'success' | 'warn' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  severity: ToastSeverity
  action?: ToastAction
  /** Auto-dismiss timeout (ms). 0 = persistent until user dismisses. */
  duration: number
}

let toastCounter = 0

/**
 * Toast notification hook with severity levels, actions, and persistence control.
 *
 * Backward-compatible: `show(message)` works as before (3s, info severity).
 * Recommended: use typed helpers (`success`, `info`, `warn`, `error`).
 */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  /**
   * Low-level show. Accepts either a string (back-compat) or an options object.
   */
  const show = useCallback((
    messageOrOpts: string | { message: string; severity?: ToastSeverity; action?: ToastAction; duration?: number },
    severity?: ToastSeverity,
  ) => {
    const id = ++toastCounter
    let toast: Toast
    if (typeof messageOrOpts === 'string') {
      toast = {
        id,
        message: messageOrOpts,
        severity: severity ?? 'info',
        duration: 3000,
      }
    } else {
      toast = {
        id,
        message: messageOrOpts.message,
        severity: messageOrOpts.severity ?? 'info',
        action: messageOrOpts.action,
        // Errors stick around by default (0 = until dismissed)
        duration: messageOrOpts.duration ?? (messageOrOpts.severity === 'error' ? 0 : 3000),
      }
    }
    setToasts(prev => [...prev, toast])
    if (toast.duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), toast.duration)
    }
    return id
  }, [])

  const success = useCallback((message: string, action?: ToastAction) =>
    show({ message, severity: 'success', action }), [show])

  const info = useCallback((message: string, action?: ToastAction) =>
    show({ message, severity: 'info', action }), [show])

  const warn = useCallback((message: string, action?: ToastAction) =>
    show({ message, severity: 'warn', action }), [show])

  const error = useCallback((message: string, action?: ToastAction) =>
    show({ message, severity: 'error', action }), [show])

  return { toasts, show, success, info, warn, error, dismiss }
}
