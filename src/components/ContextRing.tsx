// ─── Bolinha da janela de contexto (v2.70.0) ────────────────────────
//
// Anel circular que enche conforme o % usado da janela de contexto — estilo
// Claude/Anthropic, no lugar dos números "40.4k/200.0k (20%)" (que ficavam
// poluídos). Os números seguem disponíveis no tooltip (title) e no painel ao
// clicar. Cor muda em warning/critical.

interface Props {
  percentage: number
  state?: 'normal' | 'warning' | 'critical'
  size?: number
}

export function ContextRing({ percentage, state = 'normal', size = 16 }: Props) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percentage) ? percentage : 0))
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = (pct / 100) * c
  const color = state === 'critical' ? 'var(--red, #ef4444)'
    : state === 'warning' ? '#f59e0b'
    : 'var(--accent, #e07a5f)'

  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', transform: 'rotate(-90deg)' }}
      aria-hidden="true"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="var(--bg-elevated, rgba(255,255,255,0.12))" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        style={{ transition: 'stroke-dasharray 0.35s ease, stroke 0.2s' }} />
    </svg>
  )
}
