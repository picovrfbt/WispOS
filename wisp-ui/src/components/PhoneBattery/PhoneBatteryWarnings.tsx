import { useEffect, useRef } from 'react'
import { usePhoneBattery } from '@/api/battery'
import { useNotify } from '@/notify/notifyContext'
import { useSettings } from '@/settings'
import { batteryWarning } from './warnings'

/**
 * A banner when the phone runs low and isn't charging, at 15% and at 5%: once
 * each, until it's charged again. Wherever you are; off with Settings → Phone battery.
 */
export function PhoneBatteryWarnings() {
  const b = usePhoneBattery()
  const notify = useNotify()
  const { phoneBattery } = useSettings()
  const said = useRef<number | null>(null)

  useEffect(() => {
    if (!b.known || !phoneBattery) return
    const { say, said: next } = batteryWarning(b.level, b.charging, said.current)
    said.current = next
    if (say) notify(say, { variant: 'warning' })
  }, [b.known, b.level, b.charging, phoneBattery, notify])

  return null
}
