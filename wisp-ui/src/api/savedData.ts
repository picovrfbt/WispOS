import { API_BASE } from '@/config'
import { clearSavedLists } from '@/components/Home/useLibraryLists'
import { clearBakedArt } from '@/hooks/useBakedArt'
import { clearLyricsMemory } from '@/hooks/useLyrics'
import { readJson } from './client'

/** what the Car Thing keeps to be quicker (the daemon's saved_data.go) */
export interface SavedData {
  covers_bytes: number
  lyrics_bytes: number
}

export async function fetchSavedData(): Promise<SavedData | null> {
  try {
    const res = await fetch(`${API_BASE}/system/saved-data`, { cache: 'no-store' })
    return res.ok ? ((await readJson(res)) as SavedData) : null
  } catch {
    return null
  }
}

/**
 * Clears everything kept for speed: covers and lyrics on the Car Thing, the
 * blurred backgrounds and Home's saved rows here. All of it comes back as it's
 * used; nothing you set is touched.
 */
export async function clearSavedData(): Promise<boolean> {
  clearSavedLists()
  clearLyricsMemory()
  await clearBakedArt()
  try {
    const res = await fetch(`${API_BASE}/system/saved-data/clear`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}
