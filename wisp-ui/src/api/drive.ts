import { useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { subscribeEvents } from './eventBus'

// Drive Mode: music that follows the driving. The phone (the Wisp Companion)
// plays it and reads the drive; the Car Thing picks the genre and shows it.

export type DriveGenre = 'ethereal' | 'cinematic' | 'lofi'

/** the parts of the track, each 0..1 as loud as it is right now */
export interface DriveParts {
  drums: number
  bass: number
  melody: number
  choir: number
}

export interface DriveState {
  genre: DriveGenre
  playing: boolean
  /** the whole mix's loudness now, 0..1, for the glowing bar */
  level: number
  /** how clear the sound is, 0 (the haze when stopped) .. 1 (at speed) */
  clarity: number
  parts: DriveParts
  /** the phone has a GPS fix; speed_mph only comes with one */
  gps?: boolean
  speed_mph?: number
  /** the first start of a genre unpacks its music on the phone (some seconds) */
  preparing?: boolean
  /** the music downloading to the phone, percent, the first time a sound is picked */
  download?: number
  paused?: boolean
  /** why it stopped, said plainly */
  error?: string
  /** the phone's app went away */
  gone?: boolean
}

/** false when there's no phone app to play it */
export async function startDrive(genre: DriveGenre): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/drive/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function stopDrive(): Promise<void> {
  try {
    await fetch(`${API_BASE}/drive/stop`, { method: 'POST' })
  } catch {
    // leaving the screen still leaves it
  }
}

export async function pauseDrive(paused: boolean): Promise<void> {
  try {
    await fetch(`${API_BASE}/drive/${paused ? 'pause' : 'resume'}`, { method: 'POST' })
  } catch {
    // the next state says how it went
  }
}

/** the drive as the phone reports it, while [live] */
export function useDriveState(live: boolean, genre: DriveGenre): DriveState | null {
  const [state, setState] = useState<DriveState | null>(null)
  useEffect(() => {
    if (!live) return
    // the desk preview has no phone: a simulated drive stands in so the screen
    // moves, until a real phone speaks up
    let sim = import.meta.env.DEV ? simulate(genre, setState) : () => {}
    const off = subscribeEvents((evt) => {
      if (evt.type !== 'drive/state') return
      sim()
      sim = () => {}
      const s = evt.data as Partial<DriveState>
      // the phone's app went away, or it's telling of another genre than this screen's
      if (s.gone || !s.parts || s.genre !== genre) setState(null)
      else setState(s as DriveState)
    })
    return () => {
      off()
      sim()
      setState(null)
    }
  }, [live, genre])
  return state
}

// a drive on a loop: stopped, pulling away, cruising, a push, braking, stopped again
function simulate(genre: DriveGenre, set: (s: DriveState) => void): () => void {
  const t0 = Date.now()
  const id = window.setInterval(() => {
    const t = ((Date.now() - t0) / 1000) % 40
    const speed = t < 5 ? 0 : t < 14 ? ((t - 5) / 9) * 45 : t < 24 ? 45 + (t > 18 ? (t - 18) * 3.3 : 0) : t < 30 ? 65 - (t - 24) * 10.8 : 0
    const push = t > 18 && t < 24 ? 1 : t > 5 && t < 10 ? 0.6 : 0
    const s = Math.min(speed / 50, 1)
    const beat = 0.5 + 0.5 * Math.sin((Date.now() / 1000) * Math.PI * 2 * (genre === 'ethereal' ? 1.67 : genre === 'lofi' ? 1.33 : 1.5))
    const clarity = Math.min(0.03 + 0.72 * s + 0.35 * push, 1)
    const parts = {
      melody: 0.35 + 0.55 * clarity,
      choir: 0.4 + 0.5 * s,
      bass: Math.min(0.06 + 0.94 * Math.min(speed / 30, 1) + 0.3 * push, 1),
      drums: Math.max(0, Math.min(0.8 * Math.max(0, (speed - 10) / 35) + 0.6 * push, 1)) * (0.75 + 0.25 * beat),
    }
    set({
      genre,
      playing: true,
      level: Math.min(0.12 + 0.75 * clarity * (0.85 + 0.15 * beat), 1),
      clarity,
      parts,
      speed_mph: Math.round(speed),
    })
  }, 80)
  return () => window.clearInterval(id)
}
