import { useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { readJson } from './client'

/** the weather where the phone is (the daemon's weather.go) */
export interface Weather {
  temp: number
  unit: 'F' | 'C'
  code: number
  summary: string
  is_day: boolean
}

/** null until the phone has said where it is, or with no connection */
export async function fetchWeather(unit: 'F' | 'C'): Promise<Weather | null> {
  try {
    const res = await fetch(`${API_BASE}/weather?unit=${unit}`, { cache: 'no-store' })
    if (res.status !== 200) return null
    const w = (await readJson(res)) as Partial<Weather> | null
    // anything without a temperature isn't the weather (an older daemon, a proxy's page)
    return w && typeof w.temp === 'number' && (w.unit === 'F' || w.unit === 'C')
      ? (w as Weather)
      : null
  } catch {
    return null
  }
}

const EVERY_MS = 15 * 60 * 1000

/** the weather, asked again every 15 minutes while something shows it */
export function useWeather(unit: 'F' | 'C'): Weather | null {
  const [weather, setWeather] = useState<{ unit: string; w: Weather | null }>({ unit, w: null })
  useEffect(() => {
    let live = true
    const ask = () =>
      void fetchWeather(unit).then((w) => {
        if (live) setWeather({ unit, w })
      })
    ask()
    const id = window.setInterval(ask, EVERY_MS)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [unit])
  return weather.unit === unit ? weather.w : null
}

export type WeatherKind = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

/** which picture a WMO weather code gets */
export function weatherKind(w: Weather): WeatherKind {
  const c = w.code
  if (c === 0 || c === 1) return w.is_day ? 'sun' : 'moon'
  if (c === 2) return 'partly'
  if (c === 3) return 'cloud'
  if (c === 45 || c === 48) return 'fog'
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow'
  if (c >= 95) return 'storm'
  if (c >= 51) return 'rain'
  return 'cloud'
}
