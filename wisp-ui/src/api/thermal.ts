import { useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { subscribeEvents } from './eventBus'
import { readJson } from './client'

// The Car Thing's temperature sensors (the daemon's thermal.go)

export interface ThermalZone {
  /** the kernel's name: soc_thermal, ddr_thermal, ... */
  name: string
  temp_c: number
  trips?: Array<{ temp_c: number; type: string }>
}

export interface ThermalState {
  zones: ThermalZone[]
  /** the processor reached 85 °C and hasn't cooled to 75 °C yet */
  hot: boolean
  /** Performance mode is stepping aside for the heat */
  backed_off: boolean
}

/** the processor's limit, where Performance mode steps aside */
export const HOT_C = 85

const NAMES: Record<string, string> = {
  soc_thermal: 'Processor',
  ddr_thermal: 'Memory controller',
  dram_thermal: 'Memory',
  bluetooth_thermal: 'Bluetooth',
  pcb_thermal: 'Circuit board',
}

/** a sensor's name in words */
export function zoneName(z: ThermalZone): string {
  return NAMES[z.name] ?? z.name.replace(/_thermal$/, '').replace(/_/g, ' ')
}

/** a temperature in the unit Settings asks for, rounded */
export function formatTemp(c: number, unit: 'F' | 'C'): string {
  return unit === 'C' ? `${Math.round(c)}°C` : `${Math.round((c * 9) / 5 + 32)}°F`
}

export async function fetchThermal(): Promise<ThermalState | null> {
  try {
    const res = await fetch(`${API_BASE}/system/thermal`, { cache: 'no-store' })
    if (!res.ok) return null
    const t = (await readJson(res)) as Partial<ThermalState> | null
    // no sensors at all reads as an empty list (the row then hides itself)
    return t && typeof t.hot === 'boolean' ? ({ ...t, zones: t.zones ?? [] } as ThermalState) : null
  } catch {
    return null
  }
}

/** the sensors, read now and every few seconds while [live] (Settings' list is open) */
export function useThermal(live: boolean, everyMs = 3000): ThermalState | null {
  const [state, setState] = useState<ThermalState | null>(null)
  useEffect(() => {
    if (!live) return
    let alive = true
    const ask = () =>
      void fetchThermal().then((t) => {
        if (alive && t) setState(t)
      })
    ask()
    const id = window.setInterval(ask, everyMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [live, everyMs])
  return state
}

/** whether the Car Thing is hot now: asked once, then told by the daemon when it changes */
export function useThermalHot(): boolean {
  const [hot, setHot] = useState(false)
  useEffect(() => {
    let alive = true
    void fetchThermal().then((t) => {
      if (alive && t) setHot(t.hot)
    })
    const off = subscribeEvents((evt) => {
      if (evt.type === 'system/thermal') setHot((evt.data as ThermalState).hot === true)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return hot
}
