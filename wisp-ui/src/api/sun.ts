import { API_BASE } from '@/config'
import { readJson } from './client'

// Sunrise and sunset where you are (the daemon's sun.go), for night mode's
// "Auto". Worked out on the Car Thing from the phone's last location, so it
// needs no connection once the phone has said where it is.

export interface SunState {
  night: boolean
  /** when it next changes, epoch ms; 0 in a polar day or night */
  next: number
  sunrise?: number
  sunset?: number
}

/** null until the phone has ever said where it is (or with an older daemon) */
export async function fetchSun(): Promise<SunState | null> {
  try {
    const res = await fetch(`${API_BASE}/sun`, { cache: 'no-store' })
    if (res.status !== 200) return null
    const s = (await readJson(res)) as Partial<SunState> | null
    return s && typeof s.night === 'boolean' ? (s as SunState) : null
  } catch {
    return null
  }
}
