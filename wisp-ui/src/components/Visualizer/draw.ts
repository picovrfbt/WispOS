import type { VizStyle } from '@/api/viz'
import type { RGB } from '@/hooks/useColorExtract'

// The visualizer's drawings, on a 2D canvas: each style around the cover
// ("cover": a ring hugging it, the cover itself drawn on top by the page) or
// across the whole screen ("full"). Kept to plain fills and strokes, no
// shadows or filters: the Car Thing's browser draws those slowly.

export type VizLayout = 'cover' | 'full'

export interface VizState {
  /** the bands, eased between the phone's frames */
  bands: number[]
  level: number
  /** 1 on a beat, falling away */
  kick: number
  /** seconds since it started, for slow drifting */
  t: number
  particles: Particle[]
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
  hue: number
}

export function newVizState(n: number): VizState {
  return { bands: new Array(n).fill(0), level: 0, kick: 0, t: 0, particles: [] }
}

/** the cover's colour, lifted so it reads as light on the dark screen */
export function vivid(rgb: RGB): RGB {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b, 1)
  const lift = Math.min(2.2, 230 / max)
  return [Math.min(255, r * lift + 20), Math.min(255, g * lift + 20), Math.min(255, b * lift + 20)]
}

function rgba(c: RGB, a: number) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

// a second colour from the first: its complement, softened, for the treble
function partner(c: RGB): RGB {
  return [(255 - c[0]) * 0.55 + c[0] * 0.45, (255 - c[1]) * 0.55 + c[1] * 0.45, (255 - c[2]) * 0.55 + c[2] * 0.45]
}

function avg(b: number[], from: number, to: number) {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]
  return s / Math.max(1, to - from)
}

/**
 * Draws one frame. [coverFrac] is the cover's width as a share of the canvas
 * (cover layout only).
 */
export function drawViz(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: VizStyle,
  layout: VizLayout,
  s: VizState,
  color: RGB,
  coverFrac: number,
  dt: number,
) {
  ctx.clearRect(0, 0, w, h)
  const c1 = vivid(color)
  const c2 = partner(c1)
  const n = s.bands.length
  const bass = avg(s.bands, 0, 4)
  const mid = avg(s.bands, 4, 14)
  const treble = avg(s.bands, 14, n)
  const cx = w / 2
  const cy = h / 2
  // the cover's half-size, and where a ring around it starts
  const r0 = (Math.min(w, h) * coverFrac) / 2

  if (layout === 'cover') {
    if (style === 'glow') {
      // small and dim when the music is, swelling with the bass and the level
      const reach = r0 * (1.05 + 0.85 * bass + 0.3 * s.kick)
      const g = ctx.createRadialGradient(cx, cy, r0 * 0.6, cx, cy, reach)
      g.addColorStop(0, rgba(c1, 0.08 + 0.65 * s.level))
      g.addColorStop(0.55, rgba(c1, 0.03 + 0.4 * bass))
      g.addColorStop(1, rgba(c1, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      // the treble as a lighter shimmer just off the edge
      const g2 = ctx.createRadialGradient(cx, cy, r0 * 0.95, cx, cy, r0 * (1.15 + 0.4 * treble))
      g2.addColorStop(0, rgba(c2, 0.35 * treble))
      g2.addColorStop(1, rgba(c2, 0))
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, w, h)
    } else if (style === 'bars') {
      // bars standing out from the cover's edge, bass at the top, mirrored left and right
      const count = n * 2
      const inner = r0 * 1.08
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(2, ((2 * Math.PI * inner) / count) * 0.45)
      for (let i = 0; i < count; i++) {
        const band = i < n ? i : count - 1 - i
        const v = s.bands[band]
        const a = -Math.PI / 2 + (i / count) * Math.PI * 2
        const len = r0 * (0.04 + 0.5 * v + 0.1 * s.kick * (band < 4 ? 1 : 0))
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        ctx.strokeStyle = rgba(band < n / 2 ? c1 : c2, 0.45 + 0.55 * v)
        ctx.beginPath()
        ctx.moveTo(cx + cos * inner, cy + sin * inner)
        ctx.lineTo(cx + cos * (inner + len), cy + sin * (inner + len))
        ctx.stroke()
      }
    } else if (style === 'wave') {
      // a soft ring that breathes with the music, turning slowly
      for (let layer = 0; layer < 2; layer++) {
        const base = r0 * (1.1 + layer * 0.12)
        ctx.beginPath()
        const steps = 96
        for (let k = 0; k <= steps; k++) {
          const a = (k / steps) * Math.PI * 2
          const pos = (Math.sin(a * 2 + s.t * (0.6 + layer * 0.3)) * 0.5 + 0.5) * (n - 1)
          const i0 = Math.floor(pos)
          const v = s.bands[i0] + (s.bands[Math.min(n - 1, i0 + 1)] - s.bands[i0]) * (pos - i0)
          const r = base + r0 * (0.28 * v + 0.12 * s.kick)
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (k === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.lineWidth = layer === 0 ? 3 : 2
        ctx.strokeStyle = rgba(layer === 0 ? c1 : c2, layer === 0 ? 0.55 + 0.4 * s.level : 0.35 + 0.3 * treble)
        ctx.stroke()
      }
    } else {
      particles(ctx, s, cx, cy, r0 * 1.05, w, h, c1, c2, dt, 'ring')
    }
    return
  }

  // ---------------------------------------------------------------- full screen
  if (style === 'glow') {
    // three soft lights drifting, each swelling with its part of the music
    const spots: Array<[number, number, number, RGB]> = [
      [0.3 + 0.08 * Math.sin(s.t * 0.21), 0.55 + 0.1 * Math.cos(s.t * 0.17), 0.18 + 0.6 * bass + 0.2 * s.kick, c1],
      [0.7 + 0.07 * Math.cos(s.t * 0.19), 0.45 + 0.1 * Math.sin(s.t * 0.23), 0.14 + 0.5 * mid, c2],
      [0.5 + 0.12 * Math.sin(s.t * 0.13), 0.35 + 0.08 * Math.sin(s.t * 0.29), 0.08 + 0.45 * treble, c1],
    ]
    for (const [x, y, size, c] of spots) {
      const R = Math.max(w, h) * size
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, R)
      // dimmer while the music is quiet
      g.addColorStop(0, rgba(c, 0.18 + 0.45 * s.level))
      g.addColorStop(1, rgba(c, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
  } else if (style === 'bars') {
    // the spectrum across the bottom, bass in the middle, mirrored, with a faint reflection
    const count = n * 2
    const gap = 4
    const bw = (w - gap * (count + 1)) / count
    const floor = h * 0.72
    for (let i = 0; i < count; i++) {
      const band = i < n ? n - 1 - i : i - n
      const v = s.bands[band]
      const bh = Math.max(3, floor * (0.06 + 0.85 * v))
      const x = gap + i * (bw + gap)
      const g = ctx.createLinearGradient(0, floor - bh, 0, floor)
      g.addColorStop(0, rgba(c2, 0.9))
      g.addColorStop(1, rgba(c1, 0.9))
      ctx.fillStyle = g
      ctx.fillRect(x, floor - bh, bw, bh)
      ctx.fillStyle = rgba(c1, 0.12 * (0.3 + v))
      ctx.fillRect(x, floor + 3, bw, bh * 0.35)
    }
  } else if (style === 'wave') {
    // three lines across the screen: bass, middle and treble
    const parts: Array<[number, RGB, number, number]> = [
      [bass, c1, 0.6, 4],
      [mid, c2, 1.1, 3],
      [treble, c1, 1.9, 2],
    ]
    parts.forEach(([v, c, freq, lw], k) => {
      ctx.beginPath()
      for (let x = 0; x <= w; x += 8) {
        const u = x / w
        const env = Math.sin(Math.PI * u)
        const y =
          h * (0.5 + (k - 1) * 0.08) +
          Math.sin(u * Math.PI * 2 * (2 + freq) + s.t * (1.2 + freq)) * h * (0.04 + 0.28 * v) * env
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineWidth = lw
      ctx.strokeStyle = rgba(c, 0.5 + 0.45 * v)
      ctx.stroke()
    })
  } else {
    particles(ctx, s, cx, cy, Math.min(w, h) * 0.08, w, h, c1, c2, dt, 'burst')
  }
}

const MAX_PARTICLES = 140

// dots thrown out on the beat (and a few all the time, with the music's level)
function particles(
  ctx: CanvasRenderingContext2D,
  s: VizState,
  cx: number,
  cy: number,
  r: number,
  w: number,
  h: number,
  c1: RGB,
  c2: RGB,
  dt: number,
  mode: 'ring' | 'burst',
) {
  const spawn = (count: number, speed: number) => {
    for (let k = 0; k < count && s.particles.length < MAX_PARTICLES; k++) {
      const a = Math.random() * Math.PI * 2
      const v = speed * (0.5 + Math.random())
      s.particles.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1,
        size: 1.5 + Math.random() * 3 * (0.5 + s.level),
        hue: Math.random(),
      })
    }
  }
  const scale = mode === 'burst' ? Math.min(w, h) : r
  if (s.kick > 0.95) spawn(mode === 'burst' ? 26 : 14, scale * (mode === 'burst' ? 0.9 : 1.4))
  if (Math.random() < s.level * 0.9) spawn(1, scale * 0.5)
  const fade = mode === 'burst' ? 0.55 : 0.9
  const keep: Particle[] = []
  for (const p of s.particles) {
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vx *= 0.985
    p.vy *= 0.985
    p.life -= dt * fade
    if (p.life <= 0 || p.x < -10 || p.y < -10 || p.x > w + 10 || p.y > h + 10) continue
    keep.push(p)
    ctx.fillStyle = rgba(p.hue < 0.6 ? c1 : c2, p.life * 0.85)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  s.particles = keep
}
