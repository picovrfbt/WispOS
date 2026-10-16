import type { RGB } from '@/hooks/useColorExtract'

// the accent colour behind toggles, sliders and focus: a fixed one, or the
// current cover's ("album")
export type AccentTheme = 'green' | 'blue' | 'purple' | 'orange' | 'pink' | 'red' | 'album'

export const ACCENTS: Record<Exclude<AccentTheme, 'album'>, RGB> = {
  green: [30, 215, 96],
  blue: [64, 156, 255],
  purple: [168, 112, 255],
  orange: [255, 146, 48],
  pink: [255, 92, 170],
  red: [255, 82, 82],
}

export const ACCENT_ORDER: readonly AccentTheme[] = [
  'green',
  'blue',
  'purple',
  'orange',
  'pink',
  'red',
  'album',
]

export const ACCENT_LABEL: Record<AccentTheme, string> = {
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  orange: 'Orange',
  pink: 'Pink',
  red: 'Red',
  album: 'Album colours',
}

/** a cover's colour made usable as an accent: vivid enough, and bright on black */
export function readableAccent([r, g, b]: RGB): RGB {
  const [h, s, l] = rgbToHsl(r, g, b)
  return hslToRgb(h, Math.max(s, 0.55), Math.min(0.68, Math.max(l, 0.55)))
}

export function applyAccent(rgb: RGB, root: HTMLElement = document.documentElement): void {
  const [r, g, b] = rgb.map((v) => Math.round(v))
  root.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`)
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255]
}
