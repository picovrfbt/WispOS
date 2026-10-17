import { API_BASE } from '@/config'
import { readJson } from './client'

/** an add-on's addon.json (wisp-daemon/daemon/addons.go) */
export interface AddonManifest {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  entry?: string
  permissions?: AddonPermission[]
  network?: string[]
}

export type AddonPermission = 'now_playing' | 'weather' | 'location' | 'nav'

/** one the catalog offers */
export interface AddonCatalogEntry extends AddonManifest {
  zip: string
  sha256: string
  size: number
}

export async function fetchAddons(signal?: AbortSignal): Promise<AddonManifest[]> {
  const res = await fetch(`${API_BASE}/addons`, { signal })
  if (!res.ok) throw new Error(`addons: ${res.status}`)
  const body = (await readJson(res)) as { addons?: AddonManifest[] }
  return body.addons ?? []
}

export async function fetchAddonCatalog(signal?: AbortSignal): Promise<AddonCatalogEntry[]> {
  const res = await fetch(`${API_BASE}/addons/catalog`, { signal })
  const body = (await readJson(res)) as { addons?: AddonCatalogEntry[]; error?: string }
  if (!res.ok) throw new Error(body.error ?? `catalog: ${res.status}`)
  return body.addons ?? []
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function installAddon(id: string): Promise<void> {
  const res = await post('/addons/install', { id })
  if (!res.ok) {
    const body = (await readJson(res).catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `install: ${res.status}`)
  }
}

export async function removeAddon(id: string): Promise<void> {
  const res = await post('/addons/remove', { id })
  if (!res.ok) throw new Error(`remove: ${res.status}`)
}

/** a page from one of the add-on's own sites, fetched by the Car Thing */
export async function addonFetch(id: string, url: string): Promise<{ status: number; body: string }> {
  const res = await post('/addons/fetch', { id, url })
  const body = (await readJson(res)) as { status?: number; body?: string; error?: string }
  if (!res.ok) throw new Error(body.error ?? `fetch: ${res.status}`)
  return { status: body.status ?? 0, body: body.body ?? '' }
}

export function addonPageUrl(a: AddonManifest): string {
  return `${API_BASE}/addons/files/${encodeURIComponent(a.id)}/${a.entry || 'index.html'}`
}

/** what each permission lets an add-on know, as the screen says it */
export const PERMISSION_WORDS: Record<AddonPermission, string> = {
  now_playing: "what's playing",
  weather: 'the weather',
  location: 'roughly where you are',
  nav: 'your directions',
}
