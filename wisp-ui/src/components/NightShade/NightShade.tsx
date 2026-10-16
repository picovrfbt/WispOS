import { useNightMode } from '@/hooks/useNightMode'
import styles from './NightShade.module.scss'

/**
 * Night mode: one warm, dark sheet over the whole screen. A plain translucent
 * layer is the cheapest dimming Chrome 69 has; a CSS filter on the app would
 * re-run on every repaint.
 */
export function NightShade() {
  const { active } = useNightMode()
  return <div className={`${styles.shade} ${active ? styles.on : ''}`} aria-hidden />
}
