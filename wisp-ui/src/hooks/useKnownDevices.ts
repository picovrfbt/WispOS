import { useCallback, useEffect, useRef, useState } from 'react'
import * as bt from '@/api/bluetooth'
import { subscribeEvents } from '@/api/eventBus'
import type { KnownBluetoothDevice } from '@/api/types'

// a list that didn't load (Bluetooth still starting at boot) is asked for again this often
const RETRY_MS = 3000

// known (paired) BT devices for the Bluetooth pairing menu
export function useKnownDevices(active: boolean) {
  // null = not loaded yet
  const [devices, setDevices] = useState<KnownBluetoothDevice[] | null>(null)
  const retry = useRef(0)

  const refresh = useCallback(() => {
    window.clearTimeout(retry.current)
    bt.listKnownDevices()
      .then(setDevices)
      .catch(() => {
        // at boot the screens can ask before the daemon's Bluetooth is up; without
        // asking again, the Car Thing thinks it knows no phone until one connects
        retry.current = window.setTimeout(refresh, RETRY_MS)
      })
  }, [])

  useEffect(() => {
    if (!active) return
    refresh()
    const unsub = subscribeEvents((evt) => {
      if (typeof evt.type === 'string' && evt.type.startsWith('bluetooth/')) refresh()
    })
    return () => {
      unsub()
      window.clearTimeout(retry.current)
    }
  }, [active, refresh])

  return { devices, refresh }
}
