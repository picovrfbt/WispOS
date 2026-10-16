import { useState } from 'react'
import type { NavState } from '@/api/nav'
import { metresLeft, minutesLeft, parseTrip } from '@/components/Navigation/trip'
import { storedUtcOffset } from './useUtcOffset'

export interface Arrival {
  /** epoch ms */
  at: number
  /** how long the route ran, in minutes; null if it was already under way at boot */
  tripMin: number | null
}

// within this of the destination when directions end counts as arriving, not giving up
const NEAR_MIN = 2
const NEAR_M = 400
const SAID_ARRIVED = /\barriv|\bdestination\b/i

/** whether the last turn seen says the route ended at its destination */
export function endedAtDestination(last: Pick<NavState, 'title' | 'text' | 'sub_text'>): boolean {
  if (SAID_ARRIVED.test(`${last.title ?? ''} ${last.text ?? ''}`)) return true
  const parts = parseTrip(last.sub_text)
  const min = minutesLeft(parts)
  const m = metresLeft(parts)
  return (min !== null && min <= NEAR_MIN) || (m !== null && m <= NEAR_M)
}

/**
 * Notices directions ending at the destination (rather than being cancelled
 * halfway) and hands back the arrival once, until dismissed.
 */
export function useArrival(nav: NavState): { arrival: Arrival | null; dismiss: () => void } {
  const [route, setRoute] = useState<{ last: NavState; startedAt: number | null } | null>(null)
  const [arrival, setArrival] = useState<Arrival | null>(null)

  if (nav.active) {
    // the turn as it stands, and when this route began
    if (route?.last !== nav) {
      setRoute({ last: nav, startedAt: route ? route.startedAt : nav.updated_at || null })
      if (arrival) setArrival(null)
    }
  } else if (route) {
    setRoute(null)
    // a dropped phone link isn't an ending: the relay clears the turn when it gives up
    if (nav.connected && endedAtDestination(route.last)) {
      // when the daemon saw the route end: render stays pure, and it's the true moment
      const at = nav.updated_at || route.last.updated_at
      setArrival({
        at,
        tripMin: route.startedAt ? Math.max(1, Math.round((at - route.startedAt) / 60_000)) : null,
      })
    }
  }

  return { arrival, dismiss: () => setArrival(null) }
}

// the Car Thing runs on UTC: show the time where you are
export function localTime(ms: number, offsetMin = storedUtcOffset() ?? 0): string {
  const d = new Date(ms + offsetMin * 60_000)
  const h = d.getUTCHours()
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

/** "Arrived at 3:45 PM · 23 min trip" */
export function describeTrip(a: Arrival, offsetMin?: number): string {
  const when = `Arrived at ${localTime(a.at, offsetMin)}`
  if (a.tripMin === null) return when
  const h = Math.floor(a.tripMin / 60)
  const trip = h > 0 ? `${h} hr ${a.tripMin % 60} min` : `${a.tripMin} min`
  return `${when} · ${trip} trip`
}
