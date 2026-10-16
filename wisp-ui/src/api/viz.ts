import { useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { subscribeEvents } from './eventBus'
import { readJson } from './client'

// The visualizer's feed (the daemon's phone_viz.go): the phone measures what
// it's playing and sends 24 bands, bass to treble, about 20 times a second,
// only while a visualizer is on screen. Kept outside React: the canvases read
// the latest frame each time they draw.

export type VizStyle = 'glow' | 'bars' | 'wave' | 'particles'

export const VIZ_STYLES: VizStyle[] = ['glow', 'bars', 'wave', 'particles']

export const VIZ_LABEL: Record<VizStyle, string> = {
  glow: 'Glow',
  bars: 'Bars',
  wave: 'Wave',
  particles: 'Particles',
}

export const VIZ_BANDS = 24

export interface VizFrame {
  /** 0..1 each, bass first */
  bands: number[]
  /** overall loudness, 0..1 */
  level: number
  /** the bass just jumped */
  beat: boolean
  /** when it arrived (performance.now()); old frames mean silence */
  at: number
}

export interface VizStatus {
  available: boolean
  why?: string
  /** the phone has answered */
  known: boolean
}

let frame: VizFrame = { bands: new Array(VIZ_BANDS).fill(0), level: 0, beat: false, at: 0 }
let users = 0
let offEvents: (() => void) | null = null
let stopTimer = 0
let status: VizStatus | null = null
const statusListeners = new Set<(s: VizStatus | null) => void>()

/** the latest frame, for drawing */
export function vizFrame(): VizFrame {
  return frame
}

function tellDaemon(enabled: boolean) {
  void fetch(`${API_BASE}/phone/viz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).catch(() => {})
}

function setStatus(s: VizStatus | null) {
  status = s
  statusListeners.forEach((l) => l(s))
}

function begin() {
  window.clearTimeout(stopTimer)
  if (offEvents) return
  offEvents = subscribeEvents((evt) => {
    if (evt.type === 'phone/viz') {
      const d = evt.data as { b?: number[]; l?: number; beat?: boolean }
      if (!Array.isArray(d.b)) return
      frame = {
        bands: d.b.map((v) => Math.min(1, Math.max(0, v / 255))),
        level: Math.min(1, Math.max(0, (d.l ?? 0) / 255)),
        beat: d.beat === true,
        at: performance.now(),
      }
    } else if (evt.type === 'phone/viz-status') {
      setStatus(evt.data as VizStatus)
    }
  })
  tellDaemon(true)
  void fetch(`${API_BASE}/phone/viz`, { cache: 'no-store' })
    .then((r) => (r.ok ? readJson(r) : null))
    .then((s) => {
      const v = s as VizStatus | null
      if (v && typeof v.available === 'boolean' && v.known) setStatus(v)
    })
    .catch(() => {})
}

// stopping waits a moment, so moving between screens that both show one doesn't flap
function end() {
  window.clearTimeout(stopTimer)
  stopTimer = window.setTimeout(() => {
    if (users > 0) return
    offEvents?.()
    offEvents = null
    tellDaemon(false)
  }, 1500)
}

/** while [active], the phone measures; returns what it said about being able to */
export function useVizFeed(active: boolean): VizStatus | null {
  const [s, setS] = useState<VizStatus | null>(status)
  useEffect(() => {
    statusListeners.add(setS)
    return () => {
      statusListeners.delete(setS)
    }
  }, [])
  useEffect(() => {
    if (!active) return
    users++
    begin()
    return () => {
      users--
      if (users === 0) end()
    }
  }, [active])
  return s
}
