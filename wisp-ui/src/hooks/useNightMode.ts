import { useEffect, useState } from 'react'
import { useUtcOffset } from './useUtcOffset'
import { fetchSun, type SunState } from '@/api/sun'
import { useSettings, type NightMode } from '@/settings'

// "auto" is night from sunset to sunrise where you are; before the phone has
// ever said where that is, from 7pm to 7am on its clock
const NIGHT_FROM = 19
const NIGHT_TO = 7

/** whether it's night by the phone's clock; null without a time zone to go on */
export function isNightAt(nowMs: number, tzOffsetMin: number | null): boolean | null {
  if (tzOffsetMin === null) return null
  const hour = new Date(nowMs + tzOffsetMin * 60_000).getUTCHours()
  return hour >= NIGHT_FROM || hour < NIGHT_TO
}

export function nightActive(mode: NightMode, night: boolean | null): boolean {
  return mode === 'on' || (mode === 'auto' && night === true)
}

/** how often "auto" asks again, besides at each sunrise and sunset */
const SUN_EVERY_MS = 10 * 60_000

/**
 * The night-mode setting resolved to on or off. "Auto" follows the real
 * sunset and sunrise (the daemon works them out from the phone's location);
 * without those, the phone's clock: the Car Thing's runs on UTC, so 7pm-7am
 * goes by your time zone (useUtcOffset).
 */
export function useNightMode(): {
  active: boolean
  mode: NightMode
  knowsTime: boolean
  offsetMin: number | null
  /** today's sunrise and sunset, when known */
  sun: SunState | null
} {
  const { nightMode } = useSettings()
  const offset = useUtcOffset()

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (nightMode !== 'auto') return
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [nightMode])

  const [sun, setSun] = useState<SunState | null>(null)
  useEffect(() => {
    if (nightMode !== 'auto') return
    let alive = true
    let atChange = 0
    const ask = () =>
      void fetchSun().then((s) => {
        if (!alive) return
        setSun(s)
        // ask again just after it gets dark (or light), so the switch is on time
        window.clearTimeout(atChange)
        const wait = s && s.next > 0 ? s.next - Date.now() + 5_000 : 0
        if (wait > 0 && wait < SUN_EVERY_MS) atChange = window.setTimeout(ask, wait)
      })
    ask()
    const t = window.setInterval(ask, SUN_EVERY_MS)
    return () => {
      alive = false
      window.clearInterval(t)
      window.clearTimeout(atChange)
    }
  }, [nightMode])

  const night = sun ? sun.night : isNightAt(now, offset)
  return {
    active: nightActive(nightMode, night),
    mode: nightMode,
    knowsTime: sun !== null || offset !== null,
    offsetMin: offset,
    sun,
  }
}
