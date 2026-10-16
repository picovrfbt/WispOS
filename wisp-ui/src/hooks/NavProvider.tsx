import { useEffect, useState, type ReactNode } from 'react'
import { subscribeConnection, subscribeEvents } from '@/api/eventBus'
import { fetchNavStatus, NAV_IDLE, type NavLocation, type NavState } from '@/api/nav'
import { NavContext } from './navContext'

/**
 * The phone's turn-by-turn, shared by the nav screen, the banner and Home.
 * Seeded from /nav/status and kept current by the `nav` (whole state) and
 * `nav/location` (just the fix, ~1 Hz) events.
 */
export function NavProvider({ children }: { children: ReactNode }) {
  const [nav, setNav] = useState<NavState>(NAV_IDLE)

  useEffect(() => {
    let ctrl: AbortController | null = null
    const refresh = () => {
      ctrl?.abort()
      ctrl = new AbortController()
      fetchNavStatus(ctrl.signal)
        // an event can land while the fetch is in flight; keep whichever is newer
        .then((fetched) =>
          setNav((cur) =>
            fetched.updated_at >= cur.updated_at
              ? { ...fetched, location: fetched.location ?? cur.location }
              : cur,
          ),
        )
        .catch(() => {})
    }
    refresh()
    const unsubEvents = subscribeEvents((evt) => {
      // the nav event carries the whole state but a fix may be newer than its copy
      if (evt.type === 'nav') {
        const next = evt.data as NavState
        setNav((cur) => ({ ...next, location: next.location ?? cur.location }))
      } else if (evt.type === 'nav/location') {
        const location = evt.data as NavLocation
        setNav((n) => ({ ...n, location }))
      }
    })
    // anything sent while the socket was down is only in /nav/status
    const unsubConn = subscribeConnection((up) => {
      if (up) refresh()
    })
    return () => {
      ctrl?.abort()
      unsubEvents()
      unsubConn()
    }
  }, [])

  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>
}
