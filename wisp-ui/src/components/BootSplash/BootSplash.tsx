import { memo } from 'react'
import { SetupScene, WispMark } from '@/components/Setup'
import styles from './BootSplash.module.scss'

interface Props {
  caption?: string
  hint?: string // in case something takes too long
  progress?: number | null
}

// starting up: the wordmark's wisp draws itself in and its spark breathes
function BootSplashImpl({ caption, hint, progress }: Props) {
  const hasProgress = typeof progress === 'number'
  const pct = hasProgress ? Math.max(0, Math.min(100, progress)) : 0
  return (
    <SetupScene mark={false}>
      <div className={styles.center}>
        <WispMark size={84} animate />
        {caption ? <div className={styles.caption}>{caption}</div> : null}
        {hasProgress ? (
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className={styles.progressFill} style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        ) : null}
        {hint ? <div className={styles.hint}>{hint}</div> : null}
      </div>
    </SetupScene>
  )
}

export const BootSplash = memo(BootSplashImpl)
