import { useEffect, useRef, useState } from 'react'
import { estimateTokens, formatTokRate } from '../utils/streamRate'

/**
 * Live ~tokens/sec readout shown in the streaming bubble (Codex-style). App
 * mounts it only while text is actively streaming, so mount time ≈ the moment
 * the first visible token arrived (the cold-start wait is excluded — that's
 * ThinkingTimer's job). Ticks a couple times a second to refresh the rate.
 */
export function StreamRateMeter({ text }: { text: string }) {
  const startRef = useRef(Date.now())
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 500)
    return () => clearInterval(id)
  }, [])

  const label = formatTokRate(estimateTokens(text), Date.now() - startRef.current)
  if (!label) return null
  return <span className="stream-rate" aria-hidden="true">{label}</span>
}

export default StreamRateMeter
