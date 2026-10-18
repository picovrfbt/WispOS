import { memo, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { setJamSteer, startJam, stopJam, useJam } from '@/api/jam'
import { useDial } from '@/components/Home/useDial'
import styles from './Jam.module.scss'

interface Props {
  onClose: () => void
}

const STOPS = ['steer', 'done', 'stop'] as const
type Stop = (typeof STOPS)[number]

/**
 * Passengers pick the music: the QR code to scan, who's in, and Stop. Opening
 * it starts a session if none is on; closing it leaves the session running
 * (they keep picking). A small Autoplay switch: when Spotify runs out, it
 * plays songs like the passengers' instead of its own picks. The knob moves
 * between the switch, Done and Stop, a press picks, back is Done.
 */
function JamSheetImpl({ onClose }: Props) {
  const jam = useJam()
  const [focus, setFocus] = useState<Stop>('done')
  const [error, setError] = useState(false)

  useEffect(() => {
    if (jam.active) return
    let alive = true
    startJam().catch(() => alive && setError(true))
    return () => {
      alive = false
    }
    // once, as it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = () => {
    void stopJam()
    onClose()
  }

  const toggleSteer = () => void setJamSteer(!jam.steer)

  useDial({
    onStep: (dir) =>
      setFocus((f) => STOPS[Math.max(0, Math.min(STOPS.length - 1, STOPS.indexOf(f) + dir))]),
    onPress: () => (focus === 'stop' ? stop() : focus === 'steer' ? toggleSteer() : onClose()),
    onBack: onClose,
  })

  const people = jam.passengers.length
  return (
    <div className={styles.root} role="dialog" aria-label="Passengers pick the music">
      <div className={styles.qr}>
        {jam.url ? (
          <QRCodeSVG
            value={jam.url}
            size={236}
            bgColor="#ffffff"
            fgColor="#0b0b0c"
            level="M"
            marginSize={2}
          />
        ) : (
          <span className={styles.qrWait}>{error ? "Couldn't start" : 'Starting…'}</span>
        )}
      </div>
      <div className={styles.side}>
        <div className={styles.eyebrow}>Passengers pick the music</div>
        <h2 className={styles.title}>Scan to add songs</h2>
        <p className={styles.text}>
          Point a phone's camera at the code. Passengers add songs from Spotify, YouTube Music or
          SoundCloud and vote to skip, without signing in to anything of yours.
        </p>
        <div className={styles.people}>
          {people === 0 ? (
            <span className={styles.nobody}>No one's joined yet</span>
          ) : (
            jam.passengers.map((p) => (
              <span key={p} className={styles.person}>
                {p}
              </span>
            ))
          )}
        </div>
        {people > 0 ? (
          <div className={styles.votes}>
            {jam.votes > 0
              ? `${jam.votes} of ${jam.needed} voted to skip this song`
              : `${jam.needed} ${jam.needed === 1 ? 'vote skips' : 'votes skip'} a song`}
            {jam.waiting > 0 ? ` · ${jam.waiting} waiting` : ''}
          </div>
        ) : null}
        <div className={styles.toggles}>
          <button
            type="button"
            role="switch"
            aria-checked={jam.steer}
            className={`${styles.toggle} ${focus === 'steer' ? styles.on : ''}`}
            onClick={toggleSteer}
          >
            <span className={`${styles.switch} ${jam.steer ? styles.switchOn : ''}`} aria-hidden />
            Autoplay
          </button>
        </div>
        <div className={styles.buttons}>
          <button
            type="button"
            className={`${styles.btn} ${focus === 'done' ? styles.on : ''}`}
            onClick={onClose}
          >
            Done
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.stop} ${focus === 'stop' ? styles.on : ''}`}
            onClick={stop}
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  )
}

export const JamSheet = memo(JamSheetImpl)
