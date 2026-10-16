/** where the Car Thing warns about a phone that isn't charging */
export const LOW = 15
export const VERY_LOW = 5

/**
 * The warning a new reading calls for, given the last one said: each level
 * once per discharge, again only after the phone has charged past it
 */
export function batteryWarning(
  level: number,
  charging: boolean,
  lastSaid: number | null,
): { say: string | null; said: number | null } {
  if (charging || level > LOW + 5) return { say: null, said: null }
  if (level <= VERY_LOW && (lastSaid === null || lastSaid > VERY_LOW)) {
    return { say: `Phone at ${level}% and not charging`, said: VERY_LOW }
  }
  if (level <= LOW && lastSaid === null) {
    return { say: `Phone at ${level}%: plug it in`, said: LOW }
  }
  return { say: null, said: lastSaid }
}
