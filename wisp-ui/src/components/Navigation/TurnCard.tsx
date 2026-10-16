import type { NavState } from '@/api/nav'
import styles from './Navigation.module.scss'

/** the next maneuver: Google Maps' arrow, the distance, the instruction and the trip line */
export function TurnCard({ nav, compact = false }: { nav: NavState; compact?: boolean }) {
  return (
    <div className={compact ? styles.turnCompact : styles.turn}>
      <span className={styles.turnIcon}>
        {nav.icon ? <img src={nav.icon} alt="" /> : <ArrowIcon />}
      </span>
      <span className={styles.turnText}>
        {nav.title ? <span className={styles.turnTitle}>{nav.title}</span> : null}
        {nav.text ? <span className={styles.turnInstruction}>{nav.text}</span> : null}
      </span>
    </div>
  )
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="60%" height="60%" fill="currentColor" aria-hidden>
      <path d="M12 2l7 18-7-4-7 4z" />
    </svg>
  )
}
