import { memo } from 'react'
import { useThermalHot } from '@/api/thermal'
import styles from './ThermalBadge.module.scss'

/**
 * A small red thermometer in the top right corner while the Car Thing is hot
 * (its processor at 85 °C, where it starts slowing itself and Performance mode
 * steps aside), with a slow glow behind it. Gone once it's cooled to 75 °C.
 */
function ThermalBadgeImpl() {
  const hot = useThermalHot()
  if (!hot) return null
  return (
    <div className={styles.badge} role="status" aria-label="The Car Thing is hot">
      <span className={styles.glow} aria-hidden />
      <svg className={styles.icon} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2a3 3 0 0 1 3 3v8.3a5 5 0 1 1-6 0V5a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v9.4l-.4.3a3 3 0 1 0 2.8 0l-.4-.3V5a1 1 0 0 0-1-1z"
          fill="currentColor"
        />
        <path d="M12 9a1 1 0 0 1 1 1v5.2a2 2 0 1 1-2 0V10a1 1 0 0 1 1-1z" fill="currentColor" />
      </svg>
    </div>
  )
}

export const ThermalBadge = memo(ThermalBadgeImpl)
