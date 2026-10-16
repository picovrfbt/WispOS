import { API_BASE } from '@/config'
import type { LibraryItem, LibraryPage } from './library'
import { readJson } from './client'

// Music services beside Spotify (YouTube Music), read through the companion
// app on the phone, which holds the sign-in. Must match ServiceItem in
// wisp-companion's YtMusic.kt and MusicService in wisp-daemon/daemon/phone_services.go.

export interface MusicService {
  id: string
  name: string
  enabled: boolean
  signed_in: boolean
  sections?: Array<{ id: string; name: string }>
}

/** one card or row as the phone sends it */
export interface ServiceItem {
  name: string
  sub?: string
  image?: string
  /** opens it: a playlist, album or artist page */
  id?: string
  /** plays it: a playlist id, or a song's video id */
  playlist?: string
  video?: string
}

const PREFIX = 'svc:'

// what each card stands for, by the uri Home keys it on
const known = new Map<string, { service: string; item: ServiceItem }>()

export function isServiceUri(uri: string): boolean {
  return uri.startsWith(PREFIX)
}

export function serviceOf(uri: string): { service: string; item: ServiceItem } | undefined {
  return known.get(uri)
}

/** a service item as one of Home's cards or rows */
export function toLibraryItem(service: string, item: ServiceItem): LibraryItem {
  const key = item.id ?? item.playlist ?? item.video ?? item.name
  const uri = `${PREFIX}${service}:${key}`
  known.set(uri, { service, item })
  return { name: item.name, artist: item.sub ?? '', uri, image: item.image }
}

/** opens to a list (a playlist, album or artist), rather than playing straight away */
export function serviceBrowsable(uri: string): boolean {
  const s = known.get(uri)
  return !!s?.item.id && !s.item.video
}

/** a page of a service's library: one of its sections, or something's own page */
export async function fetchServicePage(
  service: string,
  id: string,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  const res = await fetch(
    `${API_BASE}/services/${encodeURIComponent(service)}/browse?id=${encodeURIComponent(id)}`,
    { signal },
  )
  const body = (await readJson(res).catch(() => null)) as {
    items?: ServiceItem[]
    error?: string
  } | null
  if (!res.ok || !body?.items) {
    throw new Error(
      body?.error ?? (res.status === 503 ? 'Phone not connected' : "Couldn't load that"),
    )
  }
  const items = body.items.map((i) => toLibraryItem(service, i))
  return { items, total: items.length }
}

/** plays in the service's app on the phone; from [startAt] when a song in it was picked */
export async function playService(
  service: string,
  item: ServiceItem,
  startAt?: ServiceItem,
): Promise<boolean> {
  const playlist = item.playlist ?? startAt?.playlist
  // a song (no page of its own) plays as itself; a playlist or album card starts at its top
  const video = startAt?.video ?? (item.id && item.playlist ? undefined : item.video)
  if (!playlist && !video) return false
  // the song's name, so the phone can check that song is the one that started
  const title = video ? (startAt ?? item).name : undefined
  try {
    const res = await fetch(`${API_BASE}/services/${encodeURIComponent(service)}/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist, video, title }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** the music service whose app (any build of it) this is, by its package */
export function serviceOfApp(pkg: string | undefined): string | null {
  if (!pkg) return null
  if (pkg.includes('youtube.music')) return 'ytmusic'
  if (pkg.includes('soundcloud')) return 'soundcloud'
  return null
}

/** the song playing in a service's app on the phone (/services/now) */
export interface ServiceNow {
  service: string
  /** the song by the service's own id, for liking it */
  current?: string
  /** absent when the service couldn't say */
  liked?: boolean
  /** what plays after it */
  items: ServiceItem[]
  /** the song's shape, heights 0-100, where the service has one (SoundCloud) */
  waveform?: number[]
  /** the song's cover by link, for an app that doesn't send its own (SoundCloud) */
  image?: string
}

/** null when the phone isn't playing a service Wisp reads, or can't be asked */
export async function fetchServiceNow(signal?: AbortSignal): Promise<ServiceNow | null> {
  try {
    const res = await fetch(`${API_BASE}/services/now`, { signal, cache: 'no-store' })
    if (!res.ok) return null
    const body = (await readJson(res)) as ServiceNow
    return { ...body, items: body.items ?? [] }
  } catch {
    return null
  }
}

/** likes (or un-likes) the song in the service's library; false when it didn't take */
export async function likeService(
  service: string,
  current: string,
  like: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/services/${encodeURIComponent(service)}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, like }),
    })
    return res.ok
  } catch {
    return false
  }
}
