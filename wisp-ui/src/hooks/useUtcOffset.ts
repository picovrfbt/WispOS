import { useEffect, useState } from 'react'
import type { ObserverStatus } from '@/api/types'
import { useNav } from './navContext'

const UTC_OFFSET_KEY = 'wisp.utcOffsetMin'
// what night mode kept before there was one shared offset
const LEGACY_PHONE_KEY = 'wisp.phoneTzOffsetMin'

function read(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** the last time zone known, for code outside React (the arrival card's text) */
export function storedUtcOffset(): number | null {
  return read(UTC_OFFSET_KEY) ?? read(LEGACY_PHONE_KEY)
}

/**
 * Minutes from UTC where you are. The Car Thing's own clock is UTC, so this
 * is your phone's time zone: straight from the phone while it's connected
 * (with daylight saving already applied), else what the daemon kept from it,
 * else the last value seen. Remembered across boots, so the clock and night
 * mode are right from the first frame. One source for the screensaver clock,
 * night mode and arrival times.
 */
export function useUtcOffset(status: ObserverStatus | null = null): number | null {
  const phone = useNav().tz_offset_min
  const daemon = status?.utc_offset_min
  const [kept, setKept] = useState<number | null>(storedUtcOffset)

  const current = typeof phone === 'number' ? phone : typeof daemon === 'number' ? daemon : kept
  useEffect(() => {
    if (current === null || current === kept) return
    setKept(current)
    try {
      window.localStorage.setItem(UTC_OFFSET_KEY, String(current))
    } catch {
      // ignore
    }
  }, [current, kept])

  return current
}

/** "UTC−4", "UTC+5:30" */
export function formatUtcOffset(min: number): string {
  const sign = min < 0 ? '−' : '+'
  const a = Math.abs(min)
  const h = Math.floor(a / 60)
  const m = a % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}
