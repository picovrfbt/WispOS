// Google Maps' trip line, e.g. "12 min · 5.1 mi · 3:45 PM ETA", split into
// what each part is. Maps words it differently by locale and version, so
// anything unrecognised is kept as a plain part rather than dropped.

export type TripPartKind = 'time' | 'distance' | 'arrival' | 'other'

export interface TripPart {
  kind: TripPartKind
  text: string
}

const ARRIVAL = /\b\d{1,2}[:.]\d{2}\b/
const DISTANCE = /\b\d+(?:[.,]\d+)?\s*(?:mi|ft|yd|km|m)\b/i
const TIME = /\b\d+\s*(?:h|hr|hrs|hour|hours|min|mins)\b/i

export function parseTrip(sub: string | undefined): TripPart[] {
  if (!sub) return []
  return sub
    .split(/\s*[·•|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => {
      // the clock first: "3:45 PM" also contains digits a duration would match
      if (ARRIVAL.test(text))
        return { kind: 'arrival', text: text.replace(/\s*ETA\s*/i, '').trim() }
      if (DISTANCE.test(text)) return { kind: 'distance', text }
      if (TIME.test(text)) return { kind: 'time', text }
      return { kind: 'other', text }
    })
}

/** miles when Maps talks in miles or feet, otherwise kilometres */
export function usesMiles(...lines: (string | undefined)[]): boolean {
  return lines.some((l) => !!l && /\b\d+(?:[.,]\d+)?\s*(?:mi|ft|yd)\b/i.test(l))
}

/** metres per second as a whole number in the driver's units */
export function speedIn(mps: number, miles: boolean): number {
  return Math.round(Math.max(0, mps) * (miles ? 2.23694 : 3.6))
}

/** the time left in minutes, from a part like "1 hr 5 min" or "12 min" */
export function minutesLeft(parts: TripPart[]): number | null {
  const t = parts.find((p) => p.kind === 'time')
  if (!t) return null
  const h = /(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(t.text)
  const m = /(\d+)\s*(?:min|mins)\b/i.exec(t.text)
  if (!h && !m) return null
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0)
}

const METRES: Record<string, number> = { mi: 1609.34, ft: 0.3048, yd: 0.9144, km: 1000, m: 1 }

/** the distance left in metres, from a part like "5.1 mi" or "800 m" */
export function metresLeft(parts: TripPart[]): number | null {
  const d = parts.find((p) => p.kind === 'distance')
  const m = d && /(\d+(?:[.,]\d+)?)\s*(mi|ft|yd|km|m)\b/i.exec(d.text)
  if (!m) return null
  return Number(m[1].replace(',', '.')) * METRES[m[2].toLowerCase()]
}
