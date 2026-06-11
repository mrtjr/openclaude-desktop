import { useEffect, useState, useCallback } from 'react'

/**
 * Accent color system (v2.11.0).
 *
 * Most surfaces in index.css already read from --accent / --accent-2 /
 * --accent-dim / --accent-border / --accent-hover, so swapping these
 * four tokens on :root retints the whole UI without touching components.
 *
 * Persisted under `openclaude-accent`. Value is either a preset id
 * (e.g. "terracotta") or a custom hex string ("#3b82f6").
 */

export interface AccentPreset {
  id: string
  label: string
  hex: string
  hex2: string // gradient partner
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'terracotta', label: 'Terracota', hex: '#e07a5f', hex2: '#9b5de5' }, // default
  { id: 'blue',       label: 'Azul',      hex: '#3b82f6', hex2: '#8b5cf6' },
  { id: 'purple',     label: 'Roxo',      hex: '#8b5cf6', hex2: '#ec4899' },
  { id: 'green',      label: 'Verde',     hex: '#10b981', hex2: '#06b6d4' },
  { id: 'pink',       label: 'Rosa',      hex: '#ec4899', hex2: '#f472b6' },
  { id: 'amber',      label: 'Âmbar',     hex: '#f59e0b', hex2: '#ef4444' },
  { id: 'red',        label: 'Vermelho',  hex: '#ef4444', hex2: '#f97316' },
  { id: 'cyan',       label: 'Ciano',     hex: '#06b6d4', hex2: '#3b82f6' },
]

const STORAGE_KEY = 'openclaude-accent'
const DEFAULT_ID = 'terracotta'

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/.{1,2}/g)
  if (!m || m.length < 3) return [224, 122, 95]
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)]
}

function lighten(hex: string, amount = 0.1): string {
  const [r, g, b] = hexToRgb(hex)
  const adj = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount))
  return `rgb(${adj(r)}, ${adj(g)}, ${adj(b)})`
}

function applyAccent(hex: string, hex2: string) {
  const root = document.documentElement
  const [r, g, b] = hexToRgb(hex)
  root.style.setProperty('--accent', hex)
  root.style.setProperty('--accent-2', hex2)
  root.style.setProperty('--accent-hover', lighten(hex, 0.12))
  // RGB triple drives every accent glow/tint/focus-ring in index.css via
  // rgba(var(--accent-rgb), α) — so a custom accent retints the WHOLE UI
  // instead of leaving ~30 hardcoded terracotta highlights behind.
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`)
  root.style.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.12)`)
  root.style.setProperty('--accent-border', `rgba(${r}, ${g}, ${b}, 0.25)`)
}

function resolveStored(raw: string | null): { hex: string; hex2: string } {
  if (!raw) {
    const def = ACCENT_PRESETS[0]
    return { hex: def.hex, hex2: def.hex2 }
  }
  if (raw.startsWith('#')) {
    // Custom hex — pair with the default gradient partner so custom
    // accents still produce a pleasant two-tone on gradient surfaces.
    return { hex: raw, hex2: ACCENT_PRESETS[0].hex2 }
  }
  const preset = ACCENT_PRESETS.find(p => p.id === raw)
  if (preset) return { hex: preset.hex, hex2: preset.hex2 }
  const def = ACCENT_PRESETS[0]
  return { hex: def.hex, hex2: def.hex2 }
}

export function useAccentColor() {
  // Current saved value (preset id or "#rrggbb")
  const [value, setValue] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_ID } catch { return DEFAULT_ID }
  })

  useEffect(() => {
    const { hex, hex2 } = resolveStored(value)
    applyAccent(hex, hex2)
    try { localStorage.setItem(STORAGE_KEY, value) } catch { /* ignore */ }
  }, [value])

  const setPreset = useCallback((id: string) => {
    const preset = ACCENT_PRESETS.find(p => p.id === id)
    if (preset) setValue(preset.id)
  }, [])

  const setCustomHex = useCallback((hex: string) => {
    // Normalise — accept "abc" / "aabbcc" / "#aabbcc".
    const clean = hex.trim().replace(/^#/, '')
    if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(clean)) return
    const full = clean.length === 3
      ? clean.split('').map(c => c + c).join('')
      : clean
    setValue('#' + full.toLowerCase())
  }, [])

  const reset = useCallback(() => setValue(DEFAULT_ID), [])

  const isCustom = value.startsWith('#')
  const currentHex = isCustom
    ? value
    : (ACCENT_PRESETS.find(p => p.id === value)?.hex ?? ACCENT_PRESETS[0].hex)

  return { value, currentHex, isCustom, setPreset, setCustomHex, reset, presets: ACCENT_PRESETS }
}
