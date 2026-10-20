import { useEffect, useRef, useState } from 'react'
import { useNav } from '@/hooks/navContext'
import { useSwipeDismiss } from '@/hooks/useSwipeDismiss'
import { useSettings } from '@/settings'
import { TurnCard } from './TurnCard'
import { bannerUntil, bannerUp, nearTurn, noteTurn, turnKey, turnMemory } from './turnBanner'
import styles from './Navigation.module.scss'

/**
 * The next turn over whatever else is on screen; a tap opens the map. It shows
 * for a while (Settings → Turn banner) when a turn comes up and again as the
 * car nears it, then gets out of the way until the next one. Swiped away, it
 * stays away until the next turn.
 */
export function NavBanner({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const nav = useNav()
  const { navBannerSecs } = useSettings()
  const ref = useRef<HTMLButtonElement>(null)
  const [, setTick] = useState(0)

  const key = turnKey(nav)
  if (nav.active) noteTurn(turnMemory, key, nearTurn(nav.title))
  const show = !hidden && nav.active && bannerUp(turnMemory, key, navBannerSecs)

  useSwipeDismiss(
    ref,
    () => {
      turnMemory.dismissed = key
      setTick((n) => n + 1)
    },
    show,
  )

  // come down again when its time is up
  const until = bannerUntil(turnMemory, navBannerSecs)
  useEffect(() => {
    if (!show || !Number.isFinite(until)) return
    const t = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, until - Date.now()) + 50)
    return () => window.clearTimeout(t)
  }, [show, until])

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
