import { useState } from 'react'
import type { ConnectDevice } from '@/api/types'
import { DeviceTypeIcon } from '@/components/DevicePicker/DevicePicker'
import { useDial } from './useDial'
import styles from './Home.module.scss'

interface Props {
  /** what's about to play, for the heading */
  label: string
  devices: ConnectDevice[]
  onPick: (device: ConnectDevice) => void
  onCancel: () => void
  /** the phone app was asked to wake Spotify (true), there is none (false), or not asked yet */
  waking?: boolean | null
}

/**
 * Nothing is playing and the daemon knows no device to start on: ask. The dial
 * moves, a press picks, back cancels.
 */
export function DeviceChooser({ label, devices, onPick, onCancel, waking = null }: Props) {
  const usable = devices.filter((d) => !d.is_offline)
  const [selected, setSelected] = useState(0)

  useDial({
    onStep: (dir) => setSelected((i) => Math.max(0, Math.min(usable.length - 1, i + dir))),
    onPress: () => {
      const d = usable[selected]
      if (d) onPick(d)
    },
    onBack: onCancel,
  })

  return (
    <div className={styles.chooserBackdrop} onClick={onCancel}>
      <div
        className={styles.chooser}
        role="dialog"
        aria-label="Play on"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.chooserTitle}>Play on…</div>
        <div className={styles.chooserSub}>{label}</div>
        {waking === true ? (
          <div className={styles.chooserHint}>
            Waking Spotify on your phone. It shows up here in a few seconds.
          </div>
        ) : waking === false ? (
          <div className={styles.chooserHint}>Not listed? Open Spotify on your phone.</div>
        ) : null}
        {usable.length === 0 ? (
          <div className={styles.status}>No Spotify devices yet</div>
        ) : (
          usable.map((d, i) => (
            <button
              key={d.id}
              type="button"
              className={`${styles.chooserRow} ${i === selected ? styles.chooserFocused : ''}`}
              onClick={() => onPick(d)}
            >
              <DeviceTypeIcon type={d.type} size={28} />
              <span className={styles.chooserName}>{d.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
