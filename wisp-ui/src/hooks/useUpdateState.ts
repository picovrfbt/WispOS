import { useEffect, useState } from 'react'
import { subscribeConnection, subscribeEvents } from '@/api/eventBus'
import { fetchUpdateStatus, type UpdateState } from '@/api/update'

/** the over-the-air updater's state, from /update/status and the update/state event */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = () =>
      void fetchUpdateStatus().then((s) => {
        if (alive && s) setState(s)
      })
    refresh()
    const unsubEvents = subscribeEvents((evt) => {
      if (evt.type === 'update/state') setState(evt.data as UpdateState)
    })
    const unsubConn = subscribeConnection((up) => {
      if (up) refresh()
    })
    return () => {
      alive = false
      unsubEvents()
      unsubConn()
    }
  }, [])
  return state
}
