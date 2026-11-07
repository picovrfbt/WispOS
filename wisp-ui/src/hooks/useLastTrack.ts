import { useEffect, useState } from 'react'
import type { ObserverStatus } from '@/api/types'

const LAST_TRACK_KEY = 'wisp.lastTrack'

export interface LastTrack {
  title: string
  artist: string
  image: string
}

function readStored(): LastTrack | null {
  try {
    const raw = window.localStorage.getItem(LAST_TRACK_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<LastTrack>
    if (typeof v.title !== 'string' || !v.title) return null
    return { title: v.title, artist: v.artist ?? '', image: v.image ?? '' }
  } catch {
    return null
  }
}

/**
 * The last song that played, remembered across boots, so the nothing-playing
 * screen can offer to pick up where the driver left off.
 */
export function useLastTrack(status: ObserverStatus | null): LastTrack | null {
  const [last, setLast] = useState<LastTrack | null>(readStored)

  const active = status?.active === true ? status : null
  const title = active?.track_name ?? ''
  const artist = active?.track_artist ?? ''
  const image = active?.track_image ?? ''
  useEffect(() => {
    if (!title) return
    const next = { title, artist, image }
    setLast(next)
    try {
      window.localStorage.setItem(LAST_TRACK_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }, [title, artist, image])

  return last
}
