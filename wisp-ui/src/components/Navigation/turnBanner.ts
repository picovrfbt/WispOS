import type { NavState } from '@/api/nav'

/**
 * Which turn this is. The distance counts down and Maps rewords the line
 * as the turn nears ("Turn right in 500 ft" / "Turn right onto Main St"), so
 * the numbers are left out; the arrow (by its size) and the street words stay.
 */
export function turnKey(nav: Pick<NavState, 'text' | 'icon'>): string {
  const words = (nav.text ?? '')
    .toLowerCase()
    .replace(/[\d.,]+\s*(?:ft|feet|mi|miles?|m|km|yd|yards?)\b/g, '')
    .replace(/\b(?:in|then)\b/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
  return `${words}|${nav.icon?.length ?? 0}`
}

// close enough that the turn is the next thing to do
const NEAR_M = 250

/** the distance line ("500 ft", "0.2 mi", "150 m") says the turn is close */
export function nearTurn(distance: string | undefined): boolean {
  const m = /([\d.,]+)\s*(ft|feet|mi|miles?|m|km|yd|yards?)\b/i.exec(distance ?? '')
  if (!m) return false
  const n = parseFloat(m[1].replace(',', '.'))
  if (!Number.isFinite(n)) return false
  const unit = m[2].toLowerCase()
  const metres = unit.startsWith('mi')
    ? n * 1609
    : unit === 'km'
      ? n * 1000
      : unit === 'ft' || unit === 'feet'
        ? n * 0.3048
        : unit.startsWith('y')
          ? n * 0.9144
          : n
  return metres <= NEAR_M
}

/**
 * What the turn banner remembers, kept outside it: the banner comes and goes
 * with the screens behind it, and a swipe has to hold through a trip from the
 * player to Home and back
 */
export interface TurnMemory {
  /** the turn on screen, and when it came up */
  key: string
  since: number
  /** when it got near: up again from then */
  nearSince: number
  /** swiped away on this turn */
  dismissed: string
}

export const turnMemory: TurnMemory = { key: '', since: 0, nearSince: 0, dismissed: '' }

/** a new turn starts its time over; getting near starts it once more */
export function noteTurn(m: TurnMemory, key: string, near: boolean, now = Date.now()): void {
  if (key !== m.key) {
    m.key = key
    m.since = now
    m.nearSince = 0
  }
  if (near && m.nearSince === 0) m.nearSince = now
}

/** until when the banner stays up for this turn (secs 0: until the turn) */
export function bannerUntil(m: TurnMemory, secs: number): number {
  if (secs === 0) return Infinity
  return Math.max(m.since, m.nearSince) + secs * 1000
}

/** whether the banner is up for [key] now */
export function bannerUp(m: TurnMemory, key: string, secs: number, now = Date.now()): boolean {
  return m.dismissed !== key && now < bannerUntil(m, secs)
}
