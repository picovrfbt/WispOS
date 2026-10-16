import type { NavState } from '@/api/nav'
import { parseTrip, speedIn, usesMiles, type TripPartKind } from './trip'
import styles from './Navigation.module.scss'

const LABEL: Record<TripPartKind, string | null> = {
  time: 'Time left',
  distance: 'Distance',
  arrival: 'Arrive',
  other: null,
}

/** the trip line as labelled chips: time left, distance left, arrival time */
export function TripChips({ nav }: { nav: NavState }) {
  const parts = parseTrip(nav.sub_text)
  if (parts.length === 0) return null
  return (
    <div className={styles.trip}>
      {parts.slice(0, 3).map((p, i) => (
        <span key={i} className={styles.tripChip}>
          {LABEL[p.kind] ? <span className={styles.tripLabel}>{LABEL[p.kind]}</span> : null}
          <span className={styles.tripValue}>{p.text}</span>
        </span>
      ))}
    </div>
  )
}

/** how fast the phone is moving, in the units Maps is using */
export function Speedo({ nav }: { nav: NavState }) {
  const speed = nav.location?.speed
  if (speed === undefined) return null
  const miles = usesMiles(nav.title, nav.text, nav.sub_text)
  return (
    <div className={styles.speedo} aria-label="Speed">
      <span className={styles.speedValue}>{speedIn(speed, miles)}</span>
      <span className={styles.speedUnit}>{miles ? 'mph' : 'km/h'}</span>
    </div>
  )
}
