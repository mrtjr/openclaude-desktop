import { useCallback, useRef, useState } from 'react'

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

const MAX_STACK = 5
const DEDUPE_WINDOW_MS = 800

let toastCounter = 0

/**
 * Toast notification hook with severity levels, actions, and persistence control.
 *
 * - **Stack cap**: max 5 visible at once (oldest gets shifted out). Error
 *   cascades used to fill the screen; this is the audit fix for v2.10.0.
 * - **Dedupe**: identical `message+severity` within 800ms is swallowed —
 *   prevents retries hammering the same toast N times.
 * - **Timeout ownership**: per-toast setTimeout handles are tracked so
 *   manual `dismiss()` cancels the scheduled removal (no stale firings
 *   hitting recycled IDs).
 *
 * Backward-compatible: `show(message)` works as before (3s, info severity).
 * Recommended: use typed helpers (`success`, `info`, `warn`, `error`).
 */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Map id → timeout handle. Enables cancellation on manual dismiss.
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  // Recent (message|severity) → timestamp for dedupe. Entries are cheap;
  // we don't bother cleaning because scope is bounded to hook lifetime.
  const recent = useRef<Map<string, number>>(new Map())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    setToasts(prev => prev.filter(tt => tt.id !== id))
  }, [])

  /**
   * Low-level show. Accepts either a string (back-compat) or an options object.
   * Returns the toast id, or -1 if the call was deduped.
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

    // Dedupe: same message+severity fired within window → drop.
    const key = `${toast.severity}|${toast.message}`
    const now = Date.now()
    const prevAt = recent.current.get(key)
    if (prevAt && now - prevAt < DEDUPE_WINDOW_MS) {
      return -1
    }
    recent.current.set(key, now)

    setToasts(prev => {
      const next = [...prev, toast]
      // Cap stack — drop oldest when exceeded, cancelling their timers.
      while (next.length > MAX_STACK) {
        const dropped = next.shift()!
        const t = timers.current.get(dropped.id)
        if (t) { clearTimeout(t); timers.current.delete(dropped.id) }
      }
      return next
    })

    if (toast.duration > 0) {
      const handle = setTimeout(() => {
        timers.current.delete(id)
        setToasts(prev => prev.filter(tt => tt.id !== id))
      }, toast.duration)
      timers.current.set(id, handle)
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
