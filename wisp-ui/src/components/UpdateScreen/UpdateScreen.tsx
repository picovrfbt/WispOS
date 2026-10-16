import { memo, useState } from 'react'
import type { UpdateState } from '@/api/update'
import { BRAND_NAME } from '@/brand'
import { downloadDetail, overallPercent, phoneLeg, STAGES, stageOf } from './progress'
import { downloadDirectly, downloadViaPhone } from '@/api/update'
import styles from './UpdateScreen.module.scss'

interface Props {
  update: UpdateState
  /** after a failure: start again */
  onRetry: () => void
  /** after a failure: back to the Car Thing */
  onClose: () => void
}

/**
 * The whole screen while an update installs with the Car Thing to itself:
 * nothing else runs, so the download has all the Bluetooth bandwidth. A bar,
 * the four stages, and what it's doing right now.
 */
function UpdateScreenImpl({ update, onRetry, onClose }: Props) {
  const failed = update.phase === 'error'
  const stage = stageOf(update)
  const pct = overallPercent(update)
  const detail = failed ? update.error : (downloadDetail(update) ?? update.step)
  const version = update.installing ?? update.latest
  // the other route, while one is downloading: the Car Thing's own, or back through the phone
  const downloading = !failed && update.phase === 'downloading'
  const switchTo =
    downloading && (update.via === 'phone' || phoneLeg(update))
      ? 'direct'
      : downloading && update.via === 'direct' && update.can_relay
        ? 'phone'
        : null
  // the route just asked for: its button stays hidden until the screen catches up
  const [asked, setAsked] = useState<'direct' | 'phone' | null>(null)
  const [seenVia, setSeenVia] = useState(update.via)
  if (seenVia !== update.via) {
    setSeenVia(update.via)
    setAsked(null)
  }
  const title = failed
    ? "The update didn't finish"
    : update.phase === 'restarting'
      ? 'Starting the new version'
      : `Updating${version ? ` to ${version}` : ''}`

  return (
    <div className={styles.screen} role="dialog" aria-label="Updating">
      <div className={styles.wordmark} aria-hidden>
        {BRAND_NAME.toLowerCase()}
      </div>
      <div className={styles.title}>{title}</div>

      {failed ? null : (
        <>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className={styles.fill} style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <ol className={styles.stages}>
            {STAGES.map((name, i) => (
              <li
                key={name}
                className={`${styles.stage} ${i < stage ? styles.done : ''} ${
                  i === stage ? styles.now : ''
                }`}
              >
                <span className={styles.dot} aria-hidden>
                  {i < stage ? '✓' : i + 1}
                </span>
                {name}
              </li>
            ))}
          </ol>
        </>
      )}

      {detail ? <div className={styles.detail}>{detail}</div> : null}

      {failed ? (
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onRetry}>
            Try again
          </button>
          <button type="button" className={styles.button} onClick={onClose}>
            Not now
          </button>
        </div>
      ) : (
        <div className={styles.note}>Keep the Car Thing plugged in. It restarts by itself.</div>
      )}

      {/* either way round while it downloads; a press hides it until the switch shows */}
      {switchTo && switchTo !== asked ? (
        <button
          type="button"
          className={styles.direct}
          onClick={() => {
            setAsked(switchTo)
            void (switchTo === 'direct' ? downloadDirectly() : downloadViaPhone())
          }}
        >
          {switchTo === 'direct'
            ? 'Download on the Car Thing instead'
            : 'Download through your phone instead'}
        </button>
      ) : null}
    </div>
  )
}

export const UpdateScreen = memo(UpdateScreenImpl)
