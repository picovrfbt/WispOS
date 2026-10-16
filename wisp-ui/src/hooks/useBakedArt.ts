import { useEffect, useState } from 'react'
import { coverUrl } from '@/api/covers'

/*
 * The cover, blurred once on a small canvas instead of by CSS filters.
 *
 * On the Car Thing (Chrome 69, a small Mali GPU, no GPU rasterization) a CSS
 * blur is re-run whenever anything on its layer repaints, and an animated
 * blurred layer re-runs it every frame. Baking the blur into a small bitmap
 * and letting the browser stretch it gives the same soft look for the cost of
 * drawing an ordinary image.
 */

export type BakeTone = 'normal' | 'dark'

export interface BakedArt {
  /** soft full-bleed background, 64px wide; stretch it with background-size: cover */
  backdrop: string
  /** the cover as a round, feathered glow on transparency, for behind the cover */
  glow: string
}

// colour treatment that the CSS filters used to apply
const TONES: Record<BakeTone, { saturate: number; brightness: number }> = {
  normal: { saturate: 1.5, brightness: 0.82 },
  dark: { saturate: 1.4, brightness: 0.5 },
}

const CACHE_MAX = 40
const cache = new Map<string, BakedArt>()
const pending = new Map<string, Promise<BakedArt | null>>()

function remember(key: string, art: BakedArt) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      const gone = cache.get(oldest)
      cache.delete(oldest)
      if (gone)
        for (const u of [gone.backdrop, gone.glow])
          if (u.startsWith('blob:')) URL.revokeObjectURL(u)
    }
  }
  cache.set(key, art)
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
  }
  return { c, ctx }
}

// saturate + brighten in place, the same maths as the CSS filter functions.
// only ever run on the few-pixel stage of a blur: reading pixels back is the
// slow part on the Car Thing, and the colour maths is linear, so toning 16px
// and then growing it looks the same as toning the grown image
function tone(ctx: CanvasRenderingContext2D, w: number, h: number, t: BakeTone) {
  const { saturate, brightness } = TONES[t]
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b
    d[i] = Math.min(255, (grey + (r - grey) * saturate) * brightness)
    d[i + 1] = Math.min(255, (grey + (g - grey) * saturate) * brightness)
    d[i + 2] = Math.min(255, (grey + (b - grey) * saturate) * brightness)
  }
  ctx.putImageData(img, 0, 0)
}

// the cover shrunk once to a small square: the only draw that touches the full
// size image, which both bakes then crop from
const BASE = 32

// shrink to a few pixels, then grow back in steps: each smoothed step blurs
function blurInto(src: HTMLCanvasElement, w: number, h: number, t: BakeTone) {
  let cur = canvas(16, Math.max(1, Math.round((16 * h) / w)))
  if (!cur.ctx) return null
  // cover-crop the square base to the target's shape
  const aspect = w / h
  const cw = aspect >= 1 ? BASE : BASE * aspect
  const ch = aspect >= 1 ? BASE / aspect : BASE
  cur.ctx.drawImage(src, (BASE - cw) / 2, (BASE - ch) / 2, cw, ch, 0, 0, cur.c.width, cur.c.height)
  tone(cur.ctx, cur.c.width, cur.c.height, t)
  while (cur.c.width < w) {
    const nw = Math.min(w, cur.c.width * 2)
    const next = canvas(nw, Math.round((nw * h) / w))
    if (!next.ctx) return null
    next.ctx.drawImage(cur.c, 0, 0, next.c.width, next.c.height)
    cur = next
  }
  return cur
}

// a canvas as an image url. toBlob encodes off the main thread; blob urls are
// revoked when the cache lets the bake go
function encode(c: HTMLCanvasElement, type: string, quality?: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof c.toBlob === 'function' && typeof URL.createObjectURL === 'function') {
        c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), type, quality)
      } else {
        resolve(c.toDataURL(type, quality))
      }
    } catch {
      // a cover served without CORS taints the canvas
      resolve(null)
    }
  })
}

// both outputs are small: Chrome puts canvases over 128x128 on the GPU, where
// every read back stalls the Car Thing's main thread, and encoding costs by the
// pixel. they hold no more detail than the 16px blur stage, so the browser
// stretching them loses nothing
const OUT = 64

async function bake(img: HTMLImageElement, t: BakeTone): Promise<BakedArt | null> {
  const sw = img.naturalWidth
  const sh = img.naturalHeight
  if (!sw || !sh) return null

  const base = canvas(BASE, BASE)
  if (!base.ctx) return null
  const side = Math.min(sw, sh)
  base.ctx.drawImage(img, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, BASE, BASE)

  let back: ReturnType<typeof blurInto>
  let sq: ReturnType<typeof blurInto>
  try {
    back = blurInto(base.c, OUT, Math.round(OUT * 0.6), t)
    // the glow: a square blur, feathered to a soft disc
    sq = blurInto(base.c, OUT, OUT, 'normal')
  } catch {
    // a tainted canvas refuses getImageData
    return null
  }
  if (!back?.ctx || !sq?.ctx) return null
  const r = OUT / 2
  const fade = sq.ctx.createRadialGradient(r, r, OUT * 0.14, r, r, r)
  fade.addColorStop(0, 'rgba(0,0,0,1)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  sq.ctx.globalCompositeOperation = 'destination-in'
  sq.ctx.fillStyle = fade
  sq.ctx.fillRect(0, 0, OUT, OUT)

  const [backdrop, glow] = await Promise.all([
    encode(back.c, 'image/jpeg', 0.85),
    encode(sq.c, 'image/png'),
  ])
  if (!backdrop || !glow) return null
  return { backdrop, glow }
}

/**
 * Load a cover and have it decoded off the main thread before anything draws
 * it: drawing an undecoded image decodes it right there, mid-frame.
 */
export function loadDecoded(url: string): {
  done: Promise<HTMLImageElement | null>
  cancel: () => void
} {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  let cancelled = false
  const done = new Promise<HTMLImageElement | null>((resolve) => {
    const finish = (ok: boolean) => resolve(ok && !cancelled ? img : null)
    if (typeof img.decode === 'function') {
      img.src = url
      img.decode().then(
        () => finish(true),
        () => finish(false),
      )
    } else {
      img.onload = () => finish(true)
      img.onerror = () => finish(false)
      img.src = url
    }
  })
  return {
    done,
    cancel: () => {
      cancelled = true
      img.onload = null
      img.onerror = null
    },
  }
}

// bakes kept between restarts in the browser's Cache Storage (which updates
// leave alone), the oldest dropped past STORE_MAX so it can't grow
const STORE = 'wisp-baked-art-v1'
const STORE_MAX = 300

function storeKey(key: string, part: 'backdrop' | 'glow') {
  return `/baked/${part}?k=${encodeURIComponent(key)}`
}

async function fromStore(key: string): Promise<BakedArt | null> {
  try {
    if (typeof caches === 'undefined') return null
    const store = await caches.open(STORE)
    const [b, g] = await Promise.all([
      store.match(storeKey(key, 'backdrop')),
      store.match(storeKey(key, 'glow')),
    ])
    if (!b || !g) return null
    const [bb, gb] = await Promise.all([b.blob(), g.blob()])
    return { backdrop: URL.createObjectURL(bb), glow: URL.createObjectURL(gb) }
  } catch {
    return null
  }
}

async function toStore(key: string, art: BakedArt): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const store = await caches.open(STORE)
    const [bb, gb] = await Promise.all([
      fetch(art.backdrop).then((r) => r.blob()),
      fetch(art.glow).then((r) => r.blob()),
    ])
    await store.put(storeKey(key, 'backdrop'), new Response(bb))
    await store.put(storeKey(key, 'glow'), new Response(gb))
    // keys come back oldest first; two per bake
    const keys = await store.keys()
    for (const k of keys.slice(0, Math.max(0, keys.length - STORE_MAX * 2))) await store.delete(k)
  } catch {
    // a full or missing store only means baking again next time
  }
}

function load(url: string, t: BakeTone): Promise<BakedArt | null> {
  const key = `${t}|${url}`
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(key)
  if (inflight) return inflight
  // a bake kept from before (it survives restarts and updates), else made now
  // from a small copy of the cover: the bake only ever samples 32px of it
  const p = fromStore(key)
    .then(
      (kept) =>
        kept ??
        loadDecoded(coverUrl(url, 64))
          .done.then((img) => (img ? bake(img, t) : null))
          .then((art) => {
            if (art) void toStore(key, art)
            return art
          }),
    )
    .then((art) => {
      if (art) remember(key, art)
      return art
    })
    .catch(() => null)
    .finally(() => pending.delete(key))
  pending.set(key, p)
  return p
}

/** the baked backdrop and glow for a cover; null until ready (or if it can't be read) */
export function useBakedArt(url: string | undefined, t: BakeTone = 'normal'): BakedArt | null {
  const key = url ? `${t}|${url}` : ''
  const [baked, setBaked] = useState<{ key: string; art: BakedArt | null }>(() => ({
    key,
    art: key ? (cache.get(key) ?? null) : null,
  }))

  useEffect(() => {
    if (!url) return
    let live = true
    void load(url, t).then((art) => {
      if (live) setBaked({ key: `${t}|${url}`, art })
    })
    return () => {
      live = false
    }
  }, [url, t])

  // a new cover keeps showing the last bake until its own is ready
  if (!url) return null
  return baked.key === key ? baked.art : (cache.get(key) ?? baked.art)
}

/** forgets every bake, in memory and kept (Settings → Storage → Clear) */
export async function clearBakedArt(): Promise<void> {
  for (const art of cache.values())
    for (const u of [art.backdrop, art.glow]) if (u.startsWith('blob:')) URL.revokeObjectURL(u)
  cache.clear()
  try {
    if (typeof caches !== 'undefined') await caches.delete(STORE)
  } catch {
    // nothing kept
  }
}
