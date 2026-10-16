import { API_BASE } from '@/config'
import { readJson } from './client'

// must match PhoneMedia in wisp-daemon/daemon/phone_media.go

/** what the phone itself is playing outside Spotify (YouTube, podcasts...) */
export interface PhoneMedia {
  present: boolean
  /** package, e.g. com.google.android.youtube */
  app?: string
  /** label, e.g. YouTube */
  app_name?: string
  title?: string
  artist?: string
  album?: string
  playing: boolean
  /** position at position_at (epoch ms); runs on from there while playing */
  position_ms: number
  position_at: number
  duration_ms: number
  /** the phone's app takes a seek */
  can_seek?: boolean
  /** changes with the cover; absent when there is none */
  art_id?: string
  updated_at: number
}

export type PhoneMediaAction =
  'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'volume_up' | 'volume_down'

export const PHONE_MEDIA_NONE: PhoneMedia = {
  present: false,
  playing: false,
  position_ms: 0,
  position_at: 0,
  duration_ms: 0,
  updated_at: 0,
}

export async function fetchPhoneMedia(signal?: AbortSignal): Promise<PhoneMedia> {
  const res = await fetch(`${API_BASE}/phone/media`, { signal, cache: 'no-store' })
  // 503: nav (and with it the phone link) is off in the daemon config
  if (!res.ok) return PHONE_MEDIA_NONE
  return (await readJson(res)) as PhoneMedia
}

/** false when the phone app isn't there to take it */
export async function phoneMediaControl(action: PhoneMediaAction): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/phone/media/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** moves the phone's player; false when it couldn't be asked */
export async function phoneMediaSeek(positionMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/phone/media/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seek', position_ms: Math.round(positionMs) }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** the cover, versioned so a new one is a new URL */
export function phoneMediaArtUrl(m: PhoneMedia): string | undefined {
  return m.art_id ? `${API_BASE}/phone/media/art?v=${m.art_id}` : undefined
}

/** where playback is now, running the clock on from the last report */
export function phoneMediaPosition(m: PhoneMedia, now = Date.now()): number {
  const pos = m.playing ? m.position_ms + Math.max(0, now - m.position_at) : m.position_ms
  return m.duration_ms > 0 ? Math.min(pos, m.duration_ms) : pos
}
