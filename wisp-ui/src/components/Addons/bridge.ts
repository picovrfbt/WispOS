import { addonFetch, type AddonManifest, type AddonPermission } from '@/api/addons'
import { fetchObserverStatus } from '@/api/client'
import { fetchNavStatus } from '@/api/nav'
import { fetchWeather } from '@/api/weather'
import { getSettings } from '@/settings'

/**
 * The Car Thing's side of an add-on's bridge (addon_sdk.js in the daemon):
 * answers what the add-on asks, but only what its manifest allows. The
 * add-on's frame is sandboxed, so this is the only way it learns anything.
 */

export interface BridgeRequest {
  wisp: 1
  id?: number
  type: string
  data?: unknown
}

// what one add-on may keep (its storage, in all)
const STORAGE_MAX = 16 * 1024

export class NotAllowed extends Error {}

function needs(a: AddonManifest, p: AddonPermission) {
  if (!a.permissions?.includes(p)) throw new NotAllowed(`this add-on didn't ask for ${p}`)
}

const storageKey = (a: AddonManifest) => `wisp.addon.${a.id}`

function readStore(a: AddonManifest): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(a)) ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** a coarse position: two decimals, about a kilometre */
const coarse = (x: number) => Math.round(x * 100) / 100

export async function answer(a: AddonManifest, req: BridgeRequest): Promise<unknown> {
  const data = (req.data ?? {}) as Record<string, unknown>
  switch (req.type) {
    case 'now_playing': {
      needs(a, 'now_playing')
      const s = await fetchObserverStatus()
      if (!s.active) return { playing: false }
      return {
        name: s.track_name,
        artist: s.track_artist,
        album: s.track_album,
        image: s.track_image,
        playing: s.is_playing && !s.is_paused,
      }
    }
    case 'weather': {
      needs(a, 'weather')
      const w = await fetchWeather(getSettings().tempUnit)
      return w ? { temp: Math.round(w.temp), unit: w.unit, summary: w.summary } : null
    }
    case 'location': {
      needs(a, 'location')
      const loc = (await fetchNavStatus()).location
      return loc
        ? { lat: coarse(loc.lat), lng: coarse(loc.lng), speed_mph: Math.round(loc.speed * 2.23694) }
        : null
    }
    case 'nav': {
      needs(a, 'nav')
      const n = await fetchNavStatus()
      return {
        active: n.active,
        distance: n.title ?? '',
        instruction: n.text ?? '',
        arrival: n.sub_text ?? '',
      }
    }
    case 'timezone': {
      // the phone's time zone: the Car Thing's own clock runs on UTC
      const s = await fetchObserverStatus()
      return s.utc_offset_min ?? 0
    }
    case 'fetch': {
      const url = String(data.url ?? '')
      let host: string
      try {
        host = new URL(url).hostname
      } catch {
        throw new NotAllowed('not a web address')
      }
      if (!a.network?.includes(host))
        throw new NotAllowed(`${host} isn't one of this add-on's sites`)
      return addonFetch(a.id, url)
    }
    case 'storage_get':
      return readStore(a)[String(data.key)] ?? null
    case 'storage_set': {
      const store = readStore(a)
      store[String(data.key)] = data.value
      const json = JSON.stringify(store)
      if (json.length > STORAGE_MAX) throw new NotAllowed('add-on storage is full')
      try {
        localStorage.setItem(storageKey(a), json)
      } catch {
        throw new NotAllowed('add-on storage is unavailable')
      }
      return true
    }
  }
  throw new NotAllowed(`unknown request ${req.type}`)
}

/** forgets what an add-on kept, when it's removed */
export function forgetAddon(a: AddonManifest) {
  try {
    localStorage.removeItem(storageKey(a))
  } catch {
    // nothing kept
  }
}
