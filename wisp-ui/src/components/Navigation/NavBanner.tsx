import { useRef, useState } from 'react'
import { useNav } from '@/hooks/navContext'
import { useSwipeDismiss } from '@/hooks/useSwipeDismiss'
import { TurnCard } from './TurnCard'
import styles from './Navigation.module.scss'

/**
 * The next turn over whatever else is on screen; a tap opens the map. Swiped
 * up, it stays away until the next maneuver, then comes back.
 */
export function NavBanner({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const nav = useNav()
  const ref = useRef<HTMLButtonElement>(null)
  // the instruction it was swiped away on; the distance ticks down, the instruction doesn't
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const turnKey = `${nav.text ?? ''}|${nav.icon?.length ?? 0}`
  const show = !hidden && nav.active && dismissedFor !== turnKey
  useSwipeDismiss(ref, () => setDismissedFor(turnKey), show)

  if (!show) return null
  return (
    <button
      ref={ref}
      type="button"
      className={styles.banner}
      onClick={onOpen}
      aria-label="Open navigation"
    >
      <TurnCard nav={nav} compact />
    </button>
  )
}
