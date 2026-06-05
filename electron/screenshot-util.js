// ─── Screenshot sizing (pure helper) ────────────────────────────────
//
// `browser-screenshot` used to ship a full-resolution PNG of the 1280×800
// viewport as base64 across the IPC boundary (~1–3 MB) on every call — and the
// only consumer (the `browser_screenshot` tool) then DISCARDED the bytes,
// returning just a misleading "Base64 available for vision analysis" string
// with no dimensions. The Dev Insights digest shows this tool is on the hot
// path (4× in 30 days, all on slow modal/GLM turns), so the wasted capture +
// encode + structured-clone is pure overhead.
//
// We now downscale to a max width and re-encode as JPEG (≈10× smaller). This
// pure helper computes the target dimensions (aspect-ratio preserving) so the
// math is unit-testable without Electron's nativeImage.

const SHOT_MAX_WIDTH = 1024 // downscale wider viewports to this
const SHOT_JPEG_QUALITY = 70 // good enough to read a page, ~10× smaller than PNG

/**
 * Plan a screenshot resize that preserves aspect ratio.
 * @param {{ width?: number, height?: number, maxWidth?: number }} p
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
function planScreenshot({ width, height, maxWidth = SHOT_MAX_WIDTH } = {}) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  // Unknown / invalid dimensions → leave as-is.
  if (w <= 0 || h <= 0) return { width: w, height: h, scaled: false }
  // Already within budget → no resize.
  if (w <= maxWidth) return { width: w, height: h, scaled: false }
  const ratio = maxWidth / w
  return { width: maxWidth, height: Math.round(h * ratio), scaled: true }
}

module.exports = { planScreenshot, SHOT_MAX_WIDTH, SHOT_JPEG_QUALITY }
