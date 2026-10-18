import { memo } from 'react'
import { usePhoneBattery } from '@/api/battery'
import { useSettings } from '@/settings'
import { useUpdateState } from '@/hooks/useUpdateState'
import { LOW } from './warnings'
import styles from './PhoneBatteryBadge.module.scss'

/** a cloud that pulses while an update downloads behind whatever is on screen */
function DownloadCloud() {
  return (
    <svg
      className={styles.cloud}
      width="22"
      height="16"
      viewBox="0 0 24 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.5 16.25a4.75 4.75 0 0 1-.6-9.46A6.25 6.25 0 0 1 18 6.5a4.9 4.9 0 0 1-.25 9.75z" />
      <path d="M12 7.5v5.25M9.75 10.75L12 13l2.25-2.25" />
    </svg>
  )
}

/**
 * The phone's battery in the top right corner of the screens that leave it
 * free (the players and the idle screen; not over lyrics, the map or
 * Settings), only while the phone isn't charging, red when it's low. Off with
 * Settings → Phone battery. A pulsing cloud sits beside it while an update
 * downloads in the background.
 */
function PhoneBatteryBadgeImpl({ hidden = false }: { hidden?: boolean }) {
  const b = usePhoneBattery()
  const { phoneBattery } = useSettings()
  const update = useUpdateState()
  const downloading = update?.phase === 'downloading' && !update.focus
  const battery = phoneBattery && b.known && !b.charging
  if (hidden || (!battery && !downloading)) return null
  const low = battery && b.level <= LOW
  const label = [
    downloading ? 'Downloading update' : '',
    battery ? `Phone battery ${b.level}%` : '',
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <div className={`${styles.badge} ${low ? styles.low : ''}`} role="status" aria-label={label}>
      {downloading ? <DownloadCloud /> : null}
      {battery ? <BatteryIcon level={b.level} /> : null}
    </div>
  )
}

function BatteryIcon({ level }: { level: number }) {
  return (
    <>
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
          width={Math.max(1, (14.5 * level) / 100)}
          height="7"
          rx="1.2"
          fill="currentColor"
        />
      </svg>
      <span className={styles.pct}>{level}%</span>
    </>
  )
}

export const PhoneBatteryBadge = memo(PhoneBatteryBadgeImpl)
