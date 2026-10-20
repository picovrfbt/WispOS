import type { NavPlace } from '@/api/nav'

/**
 * A place to look up on Where to?, from outside it: typed in the Wisp app on
 * the phone, or said ("take me to Oak Street") with more than one match. The
 * daemon sends it as "nav/find"; App opens the map, and the planner picks it up
 * when it's there (or straight away if it already is).
 */
export interface NavFind {
  q: string
  /** the matches, when they're already found */
  places?: NavPlace[]
}

let pending: NavFind | null = null
const listeners = new Set<() => void>()

export function pushFind(f: NavFind): void {
  if (!f.q?.trim()) return
  pending = f
  for (const fn of listeners) fn()
}

/** the waiting find, once */
export function takeFind(): NavFind | null {
  const f = pending
  pending = null
  return f
}

export function onFind(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
