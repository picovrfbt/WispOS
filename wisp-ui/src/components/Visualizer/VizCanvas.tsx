import { memo, useEffect, useRef } from 'react'
import { VIZ_BANDS, vizFrame, type VizFrame, type VizStyle } from '@/api/viz'
import type { RGB } from '@/hooks/useColorExtract'
import { drawViz, newVizState, type VizLayout } from './draw'

/** the Car Thing draws at about 30 a second; more only costs the screen smoothness elsewhere */
const FRAME_MS = 33

/** a frame older than this is silence (paused, or the phone went quiet) */
const STALE_MS = 600

interface Props {
  style: VizStyle
  layout: VizLayout
  color: RGB
  /** drawing at all (on screen, nothing over it) */
  active: boolean
  /** the cover's width as a share of the canvas (cover layout) */
  coverFrac?: number
  className?: string
}

/**
 * One visualizer canvas: reads the phone's latest frame each time it draws
 * and eases between them, so 20 frames a second from the phone move smoothly.
 */
function VizCanvasImpl({ style, layout, color, active, coverFrac = 0.5, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  // kept in refs so changing style or colour doesn't restart the loop
  const look = useRef({ style, color, coverFrac })
  useEffect(() => {
    look.current = { style, color, coverFrac }
  }, [style, color, coverFrac])

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!active || !canvas || !ctx) return
    const state = newVizState(VIZ_BANDS)
    let raf = 0
    let last = performance.now()
    let lastBeatAt = 0
    let alive = true

    const size = () => {
      const r = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(r.width))
      const h = Math.max(1, Math.round(r.height))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    size()
    window.addEventListener('resize', size)

    const tick = (now: number) => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      if (now - last < FRAME_MS) return
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const f = currentFrame(now)
      const fresh = now - f.at < STALE_MS
      for (let i = 0; i < state.bands.length; i++) {
        const target = fresh ? f.bands[i] : 0
        const rate = target > state.bands[i] ? 0.55 : 0.18
        state.bands[i] += (target - state.bands[i]) * rate
      }
      state.level += ((fresh ? f.level : 0) - state.level) * 0.3
      if (fresh && f.beat && f.at !== lastBeatAt) {
        lastBeatAt = f.at
        state.kick = 1
      } else {
        state.kick *= 0.86
      }
      state.t += dt
      const l = look.current
      drawViz(ctx, canvas.width, canvas.height, l.style, layout, state, l.color, l.coverFrac, dt)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', size)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [active, layout])

  return <canvas ref={ref} className={className} aria-hidden />
}

// the desk preview has no phone: a made-up beat at 120 bpm stands in when nothing arrives
function currentFrame(now: number): VizFrame {
  const f = vizFrame()
  if (!import.meta.env.DEV || now - f.at < 1500) return f
  const t = now / 1000
  const beatPhase = (t * 2) % 1
  return {
    bands: Array.from({ length: VIZ_BANDS }, (_, i) => {
      const bassy = Math.max(0, 1 - i / 8) * Math.exp(-beatPhase * 5)
      const shimmer = 0.35 + 0.3 * Math.sin(t * 3 + i * 0.7)
      return Math.min(1, bassy * 0.9 + shimmer * (0.3 + i / 40))
    }),
    level: 0.5 + 0.3 * Math.exp(-beatPhase * 5),
    beat: beatPhase < 0.07,
    at: Math.floor(t * 2) / 2 * 1000,
  }
}

export const VizCanvas = memo(VizCanvasImpl)
