interface SkeletonProps {
  /** Width in px or % (default: 100%) */
  width?: string | number
  /** Height in px (default: 14) */
  height?: number
  /** Circle shape (for avatars) */
  circle?: boolean
  /** Extra className */
  className?: string
}

/**
 * Single shimmer block. Use directly or compose via <SkeletonLines>/<SkeletonCard>.
 */
export function Skeleton({ width = '100%', height = 14, circle, className = '' }: SkeletonProps) {
  const style = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: `${height}px`,
    borderRadius: circle ? '50%' : '6px',
  }
  return <div className={`skeleton-block ${className}`} style={style} aria-hidden="true" />
}

interface SkeletonLinesProps {
  rows?: number
  /** Final row width as % (default: 70) for natural ragged look */
  lastRowWidth?: number
  className?: string
}

export function SkeletonLines({ rows = 3, lastRowWidth = 70, className = '' }: SkeletonLinesProps) {
  return (
    <div className={`skeleton-lines ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === rows - 1 ? `${lastRowWidth}%` : '100%'}
          height={12}
        />
      ))}
    </div>
  )
}

/**
 * Full message skeleton (avatar + lines) for chat streaming placeholders.
 */
export function SkeletonMessage() {
  return (
    <div className="skeleton-message" aria-label="Carregando mensagem">
      <Skeleton circle width={32} height={32} />
      <div className="skeleton-message-body">
        <Skeleton width="40%" height={12} />
        <SkeletonLines rows={3} />
      </div>
    </div>
  )
}

/**
 * Compact list item skeleton (for conversation lists, model lists, etc.).
 */
export function SkeletonListItem() {
  return (
    <div className="skeleton-list-item" aria-hidden="true">
      <Skeleton width="60%" height={13} />
      <Skeleton width="35%" height={10} />
    </div>
  )
}
