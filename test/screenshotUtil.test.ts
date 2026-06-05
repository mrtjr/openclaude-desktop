import { describe, it, expect } from 'vitest'
import { planScreenshot, SHOT_MAX_WIDTH, SHOT_JPEG_QUALITY } from '../electron/screenshot-util.js'

describe('planScreenshot', () => {
  it('downscales a wide viewport to the max width, preserving aspect ratio', () => {
    // 1280×800 → 1024×640 (ratio 0.8)
    expect(planScreenshot({ width: 1280, height: 800 })).toEqual({ width: 1024, height: 640, scaled: true })
  })

  it('leaves an already-narrow viewport untouched', () => {
    expect(planScreenshot({ width: 800, height: 600 })).toEqual({ width: 800, height: 600, scaled: false })
  })

  it('treats exactly max width as no-scale', () => {
    const r = planScreenshot({ width: SHOT_MAX_WIDTH, height: 768 })
    expect(r.scaled).toBe(false)
    expect(r.width).toBe(SHOT_MAX_WIDTH)
  })

  it('rounds the scaled height to an integer', () => {
    // 1500×1000 → ratio 1024/1500 = 0.6826..., height 682.66 → 683
    const r = planScreenshot({ width: 1500, height: 1000 })
    expect(r.width).toBe(1024)
    expect(r.height).toBe(683)
    expect(Number.isInteger(r.height)).toBe(true)
  })

  it('honours a custom maxWidth', () => {
    expect(planScreenshot({ width: 1280, height: 800, maxWidth: 640 }))
      .toEqual({ width: 640, height: 400, scaled: true })
  })

  it('handles invalid / zero / missing dimensions without scaling', () => {
    expect(planScreenshot({ width: 0, height: 0 }).scaled).toBe(false)
    expect(planScreenshot({ width: -5, height: 100 }).scaled).toBe(false)
    expect(planScreenshot({}).scaled).toBe(false)
    expect(planScreenshot().scaled).toBe(false)
  })

  it('exposes sane compression constants', () => {
    expect(SHOT_MAX_WIDTH).toBeGreaterThan(0)
    expect(SHOT_JPEG_QUALITY).toBeGreaterThan(0)
    expect(SHOT_JPEG_QUALITY).toBeLessThanOrEqual(100)
  })
})
