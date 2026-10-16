import { useEffect } from 'react'
import { useNav } from '@/hooks/navContext'
import { describeTrip, useArrival } from '@/hooks/useArrival'
import { useControls } from '@/hooks/useControls'
import { getSettings } from '@/settings'
import { speak } from '@/voice/speak'
import styles from './ArrivalCard.module.scss'

const SHOW_MS = 12_000
/**
 * The end of a route: a card saying you're there, and (Settings → When you
 * arrive) the music paused. Cancelled directions show nothing.
 */
export function ArrivalCard() {
  const nav = useNav()
  const { arrival, dismiss } = useArrival(nav)
  const { pause } = useControls()

  useEffect(() => {
    if (!arrival) return
    if (getSettings().arrivalAction === 'pause') void pause().catch(() => {})
    speak(
      arrival.tripMin === null
        ? "You've arrived."
        : `You've arrived. That took ${arrival.tripMin} minutes.`,
      'extra',
    )
    const t = window.setTimeout(dismiss, SHOW_MS)
    return () => window.clearTimeout(t)
    // once per arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival])

  if (!arrival) return null
  return (
    <button type="button" className={styles.card} onClick={dismiss} aria-label="Arrived, dismiss">
      <span className={styles.flag} aria-hidden>
        <svg viewBox="0 0 24 24" width="38" height="38" fill="currentColor">
          <path d="M5 21V4h9.4l.4 2H20v10h-6.4l-.4-2H7v7z" />
        </svg>
      </span>
      <span className={styles.text}>
        <span className={styles.title}>You've arrived</span>
        <span className={styles.sub}>{describeTrip(arrival)}</span>
      </span>
    </button>
  )
}
