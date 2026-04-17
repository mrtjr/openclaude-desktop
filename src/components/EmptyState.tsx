import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  body?: string
  action?: {
    label: string
    onClick: () => void
  }
  children?: ReactNode
  /** Compact vertical spacing (for inline contexts like empty panels). */
  compact?: boolean
}

/**
 * Reusable empty state — icon + title + body + optional CTA.
 * Keeps visual language consistent across every panel that can be empty.
 */
export default function EmptyState({ icon: Icon, title, body, action, children, compact }: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`} role="status">
      {Icon && (
        <div className="empty-state-icon" aria-hidden="true">
          <Icon size={compact ? 28 : 40} strokeWidth={1.5} />
        </div>
      )}
      <div className="empty-state-title">{title}</div>
      {body && <div className="empty-state-body">{body}</div>}
      {children}
      {action && (
        <button
          type="button"
          className="empty-state-action"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
