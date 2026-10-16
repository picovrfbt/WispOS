import { useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { subscribeEvents } from './eventBus'
import { readJson } from './client'

// The phone's battery (the daemon's phone_battery.go), as the companion app reports it

export interface PhoneBattery {
  /** false until the phone has said, and once it's gone */
  known: boolean
  level: number
  charging: boolean
}

const UNKNOWN: PhoneBattery = { known: false, level: 0, charging: false }

export function usePhoneBattery(): PhoneBattery {
  const [b, setB] = useState<PhoneBattery>(UNKNOWN)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/phone/battery`, { cache: 'no-store' })
        const v = res.ok ? ((await readJson(res)) as PhoneBattery | null) : null
        if (alive && v && typeof v.known === 'boolean') setB(v)
      } catch {
        // the event will say
      }
    })()
    const off = subscribeEvents((evt) => {
      if (evt.type === 'phone/battery') setB((evt.data as PhoneBattery) ?? UNKNOWN)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return b
}
