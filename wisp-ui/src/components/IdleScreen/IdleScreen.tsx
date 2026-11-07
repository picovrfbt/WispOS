import { memo } from 'react'
import { PhoneBatteryBadge } from '@/components/PhoneBattery'
import { ArtBackdrop } from '@/components/ArtBackdrop'
import { MusicIcon, PlayIcon } from '@/components/Controls/icons'
import { DeviceTypeIcon } from '@/components/DevicePicker'
import type { ConnectDevice } from '@/api/types'
import type { LastTrack } from '@/hooks/useLastTrack'
import styles from './IdleScreen.module.scss'

interface Props {
  connected: boolean
  devices: ConnectDevice[]
  onSelectDevice?: (device: ConnectDevice) => void
  /** the last song that played; null on a first boot */
  lastTrack?: LastTrack | null
  onResume?: () => void
}

// the chips are a shortcut, not the full device list
const MAX_DEVICES = 3

function IdleScreenImpl({ connected, devices, onSelectDevice, lastTrack, onResume }: Props) {
  const playable = devices.filter((d) => d.can_transfer && !d.is_offline).slice(0, MAX_DEVICES)

  return (
    <div className={styles.idle}>
      <ArtBackdrop src={lastTrack?.image || undefined} dark />
      <PhoneBatteryBadge />

      <div className={styles.main}>
        <div className={styles.art}>
          {lastTrack?.image ? (
            <img src={lastTrack.image} alt="" draggable={false} />
          ) : (
            <span className={styles.artEmpty} aria-hidden>
              <MusicIcon size={72} />
            </span>
          )}
        </div>

        <div className={styles.info}>
          {lastTrack ? (
            <>
              <div className={styles.label}>Pick up where you left off</div>
              <div className={styles.title}>{lastTrack.title}</div>
              {lastTrack.artist ? <div className={styles.artist}>{lastTrack.artist}</div> : null}
            </>
          ) : (
            <>
              <div className={styles.label}>Nothing playing</div>
              <div className={styles.title}>Ready when you are</div>
              <div className={styles.artist}>Start Spotify on your phone</div>
            </>
          )}
          {onResume ? (
            <button type="button" className={styles.resume} onClick={onResume}>
              <span className={styles.resumeIcon}>
                <PlayIcon size={30} />
              </span>
              <span>{lastTrack ? 'Resume' : 'Play'}</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.footer}>
        {playable.length > 0 ? (
          <div className={styles.devices}>
            <span className={styles.devicesLabel}>Play on</span>
            {playable.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`${styles.chip} ${d.is_active ? styles.chipOn : ''}`}
                onClick={onSelectDevice ? () => onSelectDevice(d) : undefined}
              >
                <DeviceTypeIcon type={d.type} size={18} />
                <span className={styles.chipName}>{d.name}</span>
              </button>
            ))}
          </div>
        ) : !connected ? (
          <div className={styles.status}>
            <span className={styles.dot} aria-hidden />
            <span>Reconnecting...</span>
          </div>
        ) : (
          <span />
        )}
        <div className={styles.backHint}>
          <span className={styles.key} aria-hidden>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </span>
          <span>Press back for Home</span>
        </div>
      </div>
    </div>
  )
}

export const IdleScreen = memo(IdleScreenImpl)
