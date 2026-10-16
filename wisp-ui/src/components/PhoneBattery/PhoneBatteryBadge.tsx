import { memo } from 'react'
import { usePhoneBattery } from '@/api/battery'
import { useSettings } from '@/settings'
import { LOW } from './warnings'
import styles from './PhoneBatteryBadge.module.scss'

/**
 * The phone's battery in the top right corner of the screens that leave it
 * free (the players and the idle screen; not over lyrics, the map or
 * Settings), only while the phone isn't charging, red when it's low. Off with
 * Settings → Phone battery.
 */
function PhoneBatteryBadgeImpl({ hidden = false }: { hidden?: boolean }) {
  const b = usePhoneBattery()
  const { phoneBattery } = useSettings()
  if (hidden || !phoneBattery || !b.known || b.charging) return null
  const low = b.level <= LOW
  return (
    <div
      className={`${styles.badge} ${low ? styles.low : ''}`}
      role="status"
      aria-label={`Phone battery ${b.level}%`}
    >
      <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
        <rect
          x="0.75"
          y="0.75"
          width="18"
          height="10.5"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <rect x="19.75" y="3.5" width="1.75" height="5" rx="0.8" fill="currentColor" />
        <rect
          x="2.5"
          y="2.5"
          width={Math.max(1, (14.5 * b.level) / 100)}
          height="7"
          rx="1.2"
          fill="currentColor"
        />
      </svg>
      <span className={styles.pct}>{b.level}%</span>
    </div>
  )
}

export const PhoneBatteryBadge = memo(PhoneBatteryBadgeImpl)
