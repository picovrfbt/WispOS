import type { NavView } from '@/settings'

/**
 * The map's zoom, smooth rather than in steps: further out the faster you go,
 * so the road ahead is on screen in time, and in again as a turn comes up,
 * the way Google Maps closes in on a junction. In quarter steps so it isn't
 * forever re-zooming by a hair.
 */
export function zoomFor(
  mps: number,
  turnM?: number | null,
  view: NavView = 'north',
  /** the driver's own nudge in or out (the + and - buttons), in zoom levels */
  nudge = 0,
): number {
  // 17.4 parked or in town, out to 15.2 at motorway speed (~67 mph)
  let z = 17.4 - Math.min(Math.max(mps / 30, 0), 1) * 2.2
  // the last 500 m to a turn: in to street level by the corner
  if (turnM != null && turnM < 500) z = Math.max(z, 17.6 - (Math.max(turnM, 0) / 500) * 1.4)
  // tilted, the road ahead already stretches away: a good deal closer
  if (view === '3d') z += 1.6
  z = Math.min(19, Math.max(12, z + nudge))
  return Math.round(z * 4) / 4
}

/** the old stepped zoom, kept for callers that only know the speed */
export function zoomForSpeed(mps: number): number {
  if (mps < 8) return 17 // under ~18 mph: streets
  if (mps < 20) return 16 // under ~45 mph
  return 15
}

/** metres in a turn distance as Maps writes it: "500 ft", "0.3 mi", "200 m", "1.2 km" */
export function distanceMetres(text?: string | null): number | null {
  const m = /([\d.,]+)\s*(ft|mi|m|km|yd)\b/i.exec(text ?? '')
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.'))
  if (!Number.isFinite(n)) return null
  const unit = m[2].toLowerCase()
  const per =
    unit === 'ft'
      ? 0.3048
      : unit === 'mi'
        ? 1609.34
        : unit === 'km'
          ? 1000
          : unit === 'yd'
            ? 0.9144
            : 1
  return n * per
}
