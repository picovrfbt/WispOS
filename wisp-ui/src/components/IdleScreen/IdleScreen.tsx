import { memo } from 'react'
import { PhoneBatteryBadge } from '@/components/PhoneBattery'
import { PlayIcon } from '@/components/Controls/icons'
import { DevicePicker } from '@/components/DevicePicker'
import type { ConnectDevice } from '@/api/types'
import styles from './IdleScreen.module.scss'

interface Props {
  connected: boolean
  devices: ConnectDevice[]
  onSelectDevice?: (device: ConnectDevice) => void
}

function IdleScreenImpl({ connected, devices, onSelectDevice }: Props) {
  const subtitle =
    devices.length > 0
      ? 'Pick where to play below'
      : 'Play something in Spotify on your phone and it shows up here'

  return (
    <div className={styles.idle}>
      <PhoneBatteryBadge />
      <div className={styles.icon} aria-hidden>
        <PlayIcon size={64} />
      </div>
      <div className={styles.title}>Nothing playing</div>
      <div className={styles.hint}>{subtitle}</div>
      <DevicePicker devices={devices} onSelect={onSelectDevice} placement="inline" />
      {!connected ? (
        <div className={styles.status}>
          <span className={`${styles.dot} ${styles.dotOff}`} aria-hidden />
          <span>Reconnecting...</span>
        </div>
      ) : null}
    </div>
  )
}

export const IdleScreen = memo(IdleScreenImpl)
