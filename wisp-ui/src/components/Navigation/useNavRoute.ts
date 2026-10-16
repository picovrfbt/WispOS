import { useEffect, useState } from 'react'
import { fetchNavRoute, type NavRoute } from '@/api/nav'

/** the route line, fetched again whenever its revision moves; null for none */
export function useNavRoute(rev: number | undefined): NavRoute | null {
  const [route, setRoute] = useState<NavRoute | null>(null)
  useEffect(() => {
    if (!rev) return
    const ac = new AbortController()
    fetchNavRoute(ac.signal)
      .then((r) => setRoute(r.kind && r.points.length > 1 ? r : null))
      .catch(() => {
        // the next revision tries again
      })
    return () => ac.abort()
  }, [rev])
  return rev ? route : null
}
