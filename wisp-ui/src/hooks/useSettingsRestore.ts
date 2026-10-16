import { useEffect } from 'react'
import { subscribeEvents } from '@/api/eventBus'
import { reloadSettings } from '@/settings'
import type { NotifyFn } from '@/notify/notifyContext'

/**
 * Settings the daemon took from the phone: the backup after a reflash (said
 * so), or a change made on the companion app's Car Thing settings page (just
 * taken, it shows for itself).
 */
export function useSettingsRestore(notify: NotifyFn) {
  useEffect(
    () =>
      subscribeEvents((evt) => {
        if (evt.type === 'settings/changed') {
          void reloadSettings()
          return
        }
        if (evt.type !== 'settings/restored') return
        void reloadSettings().then((ok) => {
          if (ok) notify('Settings restored from your phone', { icon: 'success' })
        })
      }),
    [notify],
  )
}
