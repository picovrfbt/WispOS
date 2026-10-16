import { API_BASE } from '@/config'
import { readJson } from './client'
import type { MusicService } from './services'

// must match NavState / NavLocation in wisp-daemon/daemon/nav.go

export interface NavLocation {
  lat: number
  lng: number
  /** degrees clockwise from north */
  bearing: number
  /** m/s */
  speed: number
  /** metres */
  accuracy: number
}

export interface NavState {
  /** the phone's companion app is reachable */
  connected: boolean
  /** Google Maps is navigating */
  active: boolean
  /** usually the distance to the next maneuver, e.g. "500 ft" */
  title?: string
  /** usually the instruction, e.g. "Turn right onto Main St" */
  text?: string
  /** usually the trip line, e.g. "12 min · 5.1 mi · 3:45 PM" */
  sub_text?: string
  /** maneuver arrow as a data:image/png URL */
  icon?: string
  location?: NavLocation
  /** the phone's offset from UTC in minutes; the Car Thing's own clock is UTC */
  tz_offset_min?: number
  /** Wisp's voice on the phone: absent | downloading | ready | failed */
  voice_state?: 'absent' | 'downloading' | 'ready' | 'failed'
  voice_percent?: number
  voice_error?: string
  /** music services beside Spotify on the phone (YouTube Music) */
  services?: MusicService[]
  /** the route line's revision: fetch /nav/route when it changes (absent: none yet) */
  route_rev?: number
  /** the trip from a shared destination, or the road to the next turn */
  route_kind?: 'full' | 'next'
  updated_at: number
}

export const NAV_IDLE: NavState = { connected: false, active: false, updated_at: 0 }

export async function fetchNavStatus(signal?: AbortSignal): Promise<NavState> {
  const res = await fetch(`${API_BASE}/nav/status`, { signal, cache: 'no-store' })
  // 503: nav is disabled in the daemon config
  if (!res.ok) return NAV_IDLE
  return (await readJson(res)) as NavState
}

/** asks the phone app to start Spotify so it rejoins Connect; false with no phone app */
/** the route line the phone worked out: [lat, lng] pairs, start to end */
export interface NavRoute {
  kind: '' | 'full' | 'next'
  rev: number
  points: [number, number][]
}

export async function fetchNavRoute(signal?: AbortSignal): Promise<NavRoute> {
  const res = await fetch(`${API_BASE}/nav/route`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`nav route ${res.status}`)
  return (await res.json()) as NavRoute
}

export async function wakeSpotify(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/nav/wake-spotify`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}
