import { useEffect, useRef } from 'react'
import { clearRolledBack, rolledBackMessage } from '@/api/update'
import { useUpdateState } from './useUpdateState'
import type { NotifyFn } from '@/notify/notifyContext'

/**
 * Says once that an update didn't come up and was undone (the daemon went
 * back to the update before it, or to the version installed over USB).
 */
export function useRollbackNotice(notify: NotifyFn) {
  const u = useUpdateState()
  const said = useRef('')
  const r = u?.rolled_back
  useEffect(() => {
    if (!r) return
    const key = `${r.from}@${r.at}`
    if (said.current === key) return
    said.current = key
    notify(rolledBackMessage(r), { variant: 'warning' })
    void clearRolledBack()
  }, [r, notify])
}
