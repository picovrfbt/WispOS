import { memo } from 'react'
import styles from './Setup.module.scss'

export type LinkFrom = 'phone' | 'computer'
export type LinkState = 'waiting' | 'linked'

interface Props {
  from: LinkFrom
  /** waiting: the Car Thing is a dashed outline and light flows toward it; linked: it's lit */
  state: LinkState
}

/**
 * The wisp of light from the phone (or computer) to the Car Thing, the scene
 * the phone app shows while it links (WispViews.kt's WispLink). Light drifts
 * along the wisp toward the Car Thing until they're linked.
 */
function WispLinkImpl({ from, state }: Props) {
  const linked = state === 'linked'
  return (
    <svg
      className={[styles.link, linked ? styles.linkLinked : ''].join(' ')}
      viewBox="0 0 320 120"
      aria-hidden
    >
      {from === 'phone' ? (
        <g className={styles.linkDevice}>
          <rect x="22" y="22" width="44" height="76" rx="9" />
          <line x1="38" y1="88" x2="50" y2="88" />
        </g>
      ) : (
        <g className={styles.linkDevice}>
          <rect x="10" y="30" width="66" height="44" rx="5" />
          <line x1="2" y1="84" x2="84" y2="84" />
        </g>
      )}

      <path className={styles.linkTrack} d="M80 66 C125 22 160 98 200 56 C222 34 236 40 248 50" />
      <path className={styles.linkFlow} d="M80 66 C125 22 160 98 200 56 C222 34 236 40 248 50" />

      <g className={styles.linkCarThing}>
        <rect x="252" y="34" width="62" height="52" rx="8" />
        <circle cx="296" cy="60" r="6" />
      </g>
      <circle className={styles.linkSpark} cx={linked ? 248 : 80} cy={linked ? 50 : 66} r="4" />
    </svg>
  )
}

export const WispLink = memo(WispLinkImpl)
