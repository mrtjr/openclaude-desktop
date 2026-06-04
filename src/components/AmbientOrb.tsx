/**
 * Ambient gradient orb that drifts behind the composer while the model
 * is generating (v2.11.0). Two blurred layers in the accent gradient;
 * all animation is CSS-only to keep the streaming hot-path cheap.
 *
 * Decorative — `aria-hidden` because the textual streaming indicator
 * already conveys loading state to assistive tech.
 */
interface AmbientOrbProps {
  visible: boolean
}

export function AmbientOrb({ visible }: AmbientOrbProps) {
  if (!visible) return null
  return (
    <div className="ambient-orb" aria-hidden="true">
      <span className="ambient-orb-core" />
      <span className="ambient-orb-halo" />
    </div>
  )
}
