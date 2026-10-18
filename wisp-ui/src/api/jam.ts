import { useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { readJson } from './client'
import { subscribeEvents } from './eventBus'

// Passengers pick the music (the daemon's jam.go): a session with a link for
// its QR code, who's in, and the skip votes for the song playing.

export interface JamState {
  active: boolean
  url?: string
  passengers: string[]
  votes: number
  needed: number
  /** the passengers' songs waiting to play, from any service */
  waiting: number
  /** when Spotify runs out, it plays more like the passengers' Spotify songs */
  steer: boolean
  /** songs the passengers added, to keep as a playlist (stays after the session until saved or forgotten) */
  picks: number
}

/** the playlist the passengers' songs went into */
export interface JamSaved {
  name: string
  uri: string
  songs: number
  /** YouTube Music or SoundCloud picks with no match on Spotify */
  missing: number
}

export const JAM_OFF: JamState = {
  active: false,
  passengers: [],
  votes: 0,
  needed: 1,
  waiting: 0,
  steer: true,
  picks: 0,
}

export async function fetchJam(): Promise<JamState> {
  try {
    const res = await fetch(`${API_BASE}/jam`, { cache: 'no-store' })
    return res.ok ? { ...JAM_OFF, ...((await readJson(res)) as JamState) } : JAM_OFF
  } catch {
    return JAM_OFF
  }
}

export async function startJam(): Promise<JamState> {
  const res = await fetch(`${API_BASE}/jam/start`, { method: 'POST' })
  if (!res.ok) throw new Error(`jam: ${res.status}`)
  return { ...JAM_OFF, ...((await readJson(res)) as JamState) }
}

export async function setJamSteer(on: boolean): Promise<void> {
  await fetch(`${API_BASE}/jam/steer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on }),
  }).catch(() => {})
}

export async function saveJam(): Promise<JamSaved> {
  const res = await fetch(`${API_BASE}/jam/save`, { method: 'POST' })
  if (!res.ok) throw new Error(`jam save: ${res.status}`)
  return (await readJson(res)) as JamSaved
}

export async function forgetJam(): Promise<void> {
  await fetch(`${API_BASE}/jam/forget`, { method: 'POST' }).catch(() => {})
}

export async function stopJam(): Promise<void> {
  await fetch(`${API_BASE}/jam/stop`, { method: 'POST' }).catch(() => {})
}

/** the session, kept current by its events */
export function useJam(): JamState {
  const [state, setState] = useState<JamState>(JAM_OFF)
  useEffect(() => {
    let alive = true
    // an event is newer than a fetch that answers after it (a session just started, say)
    let heard = false
    void fetchJam().then((s) => alive && !heard && setState(s))
    const off = subscribeEvents((evt) => {
      if (evt.type !== 'jam/state') return
      heard = true
      setState({ ...JAM_OFF, ...(evt.data as JamState) })
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}
