import { API_BASE } from '@/config'
import { readJson } from './client'

export type LibraryFilter = 'playlists' | 'albums' | 'artists'

export interface LibraryItem {
  name: string
  artist: string
  uri: string
  image?: string
}

export interface LibraryPage {
  items: LibraryItem[]
  total: number
}

export const LIKED_SONGS_URI = 'spotify:collection:tracks'

// a little past the daemon's own 25s limit, so a stalled page ends in Retry
const PAGE_TIMEOUT_MS = 30_000

async function getPage(path: string, params: URLSearchParams, signal?: AbortSignal) {
  // Chrome 69 has no AbortSignal.timeout/any, so link the two by hand
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}?${params}`, { signal: ctrl.signal, cache: 'no-store' })
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new Error('Timed out', { cause: e })
    throw e
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  // 204/503: the daemon has no Spotify session yet
  if (res.status === 204 || res.status === 503) throw new Error('not connected to Spotify')
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  const body = (await readJson(res)) as Partial<LibraryPage> | null
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    total: typeof body?.total === 'number' ? body.total : 0,
  }
}

function paging(offset: number, limit: number, extra: Record<string, string> = {}) {
  return new URLSearchParams({ ...extra, offset: String(offset), limit: String(limit) })
}

export function fetchLibraryList(
  filter: LibraryFilter,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  return getPage('/library/list', paging(offset, limit, { filter }), signal)
}

/** playlists, albums, artists and shows together, most recently played first */
export function fetchRecents(
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  return getPage('/library/recents', paging(offset, limit), signal)
}

/** tracks of a playlist, or of Liked Songs for LIKED_SONGS_URI */
export function fetchContextTracks(
  uri: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  if (uri === LIKED_SONGS_URI) return getPage('/library/liked', paging(offset, limit), signal)
  return getPage('/library/playlist', paging(offset, limit, { uri }), signal)
}

/** whether a context opens into a track list rather than playing straight away */
// Spotify's DJ is a playlist only in name: it has no fixed tracks to list
const DJ_URI = 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq'

export function isBrowsable(uri: string): boolean {
  return uri === LIKED_SONGS_URI || (uri.startsWith('spotify:playlist:') && uri !== DJ_URI)
}

export interface PlayOptions {
  skipToUri?: string
  shuffle?: boolean
  /** a Connect device to play on, rather than the active (or last active) one */
  deviceId?: string
}

/** a failed play; 404 means there was no device to send it to */
export class PlayError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`player/play ${status}`)
    this.status = status
  }
}

/** plays a context on the active device, optionally from a track or shuffled */
export async function playFromLibrary(contextUri: string, opts: PlayOptions = {}): Promise<void> {
  const body: Record<string, unknown> = { uri: contextUri }
  if (opts.skipToUri) body.skip_to_uri = opts.skipToUri
  if (opts.shuffle !== undefined) body.shuffle = opts.shuffle
  if (opts.deviceId) body.device_id = opts.deviceId
  const res = await fetch(`${API_BASE}/player/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new PlayError(res.status)
}
