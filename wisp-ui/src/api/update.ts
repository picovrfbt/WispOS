import { API_BASE } from '@/config'
import { readJson } from './client'

// must match UpdateState in wisp-daemon/daemon/updater.go

export type UpdatePhase =
  'idle' | 'checking' | 'downloading' | 'installing' | 'restarting' | 'error'

export interface UpdateState {
  current: string
  latest?: string
  /** latest is newer than current and has a bundle to install */
  available: boolean
  highlights?: string[]
  phase: UpdatePhase
  percent?: number
  error?: string
  /** a GitHub token is known (the repo is private) */
  has_token: boolean
  checked_at?: number
  /** what the install is doing now, in words */
  step?: string
  bytes_done?: number
  bytes_total?: number
  /** download speed, bytes a second */
  speed_bps?: number
  /** the install has the Car Thing to itself: show only the updating screen */
  focus?: boolean
  /** the release being installed */
  installing?: string
  /** how it's coming while it downloads: through the phone, or by the Car Thing itself */
  via?: 'phone' | 'direct'
  /** the phone is there to download through */
  can_relay?: boolean
  /** an update didn't come up and was undone; said once, then clearRolledBack() */
  rolled_back?: RolledBack
}

export interface RolledBack {
  from: string
  /** the update gone back to; empty for the version installed over USB */
  to: string
  why: string
  at: number
}

/** the user has been told an update was undone */
export async function clearRolledBack(): Promise<void> {
  try {
    await fetch(`${API_BASE}/update/rolled-back`, { method: 'POST' })
  } catch {
    // said again next start, which is fine
  }
}

/** the banner for an undone update */
export function rolledBackMessage(r: RolledBack): string {
  const back = r.to ? r.to : 'the version installed over USB'
  return `${r.from} didn't start properly, so Wisp went back to ${back}`
}

export async function fetchUpdateStatus(): Promise<UpdateState | null> {
  try {
    const res = await fetch(`${API_BASE}/update/status`, { cache: 'no-store' })
    return res.ok ? ((await readJson(res)) as UpdateState) : null
  } catch {
    return null
  }
}

/** asks GitHub now; resolves with the result */
export async function checkForUpdate(): Promise<UpdateState | null> {
  try {
    const res = await fetch(`${API_BASE}/update/check`, { method: 'POST' })
    return res.ok ? ((await readJson(res)) as UpdateState) : null
  } catch {
    return null
  }
}

/** starts the download and install; false when there's nothing to install */
export async function installUpdate(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/update/install`, { method: 'POST' })
    return res.status === 202
  } catch {
    return false
  }
}

/** tells the daemon this version's UI came up, so it keeps the update */
export async function confirmUpdate(): Promise<void> {
  try {
    await fetch(`${API_BASE}/update/confirm`, { method: 'POST' })
  } catch {
    // the daemon falls back on its own if it never hears this
  }
}

/** stop going through the phone: the Car Thing downloads the rest from GitHub itself */
export async function downloadDirectly(): Promise<void> {
  await fetch(`${API_BASE}/update/direct`, { method: 'POST' }).catch(() => {})
}

/** back the other way: the rest comes through the phone again */
export async function downloadViaPhone(): Promise<void> {
  await fetch(`${API_BASE}/update/relay`, { method: 'POST' }).catch(() => {})
}
