import { API_BASE } from '@/config'

/*
 * Covers through the Car Thing's own cover cache (the daemon's /img): each is
 * downloaded once, shrunk to the size it's shown at, and kept on the Car
 * Thing, so it comes back instantly, offline too, and decodes quickly. Only
 * the services' image hosts go through it; anything else (the phone's cover,
 * a data URL) is used as it is.
 */

const HOSTS = [
  'scdn.co',
  'spotifycdn.com',
  'googleusercontent.com',
  'ggpht.com',
  'ytimg.com',
  'sndcdn.com',
  'mzstatic.com',
]

function cacheable(url: string): boolean {
  if (!url.startsWith('https://')) return false
  const host = url.slice(8).split(/[/?#]/, 1)[0].toLowerCase()
  return HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** a cover at the size it's shown (px), from the Car Thing's cache when it can be */
export function coverUrl(url: string, size: number): string
export function coverUrl(url: string | undefined, size: number): string | undefined
export function coverUrl(url: string | undefined, size: number): string | undefined {
  if (!url || !cacheable(url)) return url
  return `${API_BASE}/img?s=${Math.round(size)}&u=${encodeURIComponent(url)}`
}

// held until loaded, so a prefetch isn't dropped half way
const warming = new Set<HTMLImageElement>()

/** loads covers into the cache ahead of time: the next songs, the cards past the screen */
export function prefetchCovers(urls: Array<string | undefined>, size: number): void {
  for (const u of urls) {
    const src = coverUrl(u, size)
    if (!src || warming.size > 24) continue
    const img = new Image()
    // the same way the backdrop bakes load it, so the browser reuses this copy
    img.crossOrigin = 'anonymous'
    const done = () => warming.delete(img)
    img.onload = done
    img.onerror = done
    warming.add(img)
    img.src = src
  }
}
