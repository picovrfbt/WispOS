import type { ReactNode } from 'react'
import { memo } from 'react'
import { Marquee } from './Marquee'
import styles from './TrackInfo.module.scss'

interface Props {
  trackName: string
  artist: string
  large?: boolean
  /** a small mark before the artist: the service it's playing from */
  badge?: ReactNode
}

function TrackInfoImpl({ trackName, artist, large = false, badge }: Props) {
  return (
    <div className={`${styles.info} ${large ? styles.large : ''}`}>
      <Marquee text={trackName || 'Unknown track'} className={styles.title} />
      {badge ? (
        <div className={styles.artistRow}>
          <span className={styles.badge}>{badge}</span>
          <Marquee text={artist} className={styles.artist} />
        </div>
      ) : (
        <Marquee text={artist} className={styles.artist} />
      )}
    </div>
  )
}

export const TrackInfo = memo(TrackInfoImpl)
