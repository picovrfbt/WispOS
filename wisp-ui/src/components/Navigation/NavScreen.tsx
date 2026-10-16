import { useNav } from '@/hooks/navContext'
import { useNavRoute } from './useNavRoute'
import { lazy, Suspense } from 'react'

// Leaflet is a sizeable script the Car Thing would otherwise parse at every boot
// for a screen that's rarely open; it loads the first time the map is
const NavMap = lazy(() => import('./NavMap').then((m) => ({ default: m.NavMap })))
import { TurnCard } from './TurnCard'
import { Speedo, TripChips } from './TripInfo'
import styles from './Navigation.module.scss'

interface Props {
  onClose: () => void
  /** the song underneath, so the map doesn't hide what's playing */
  nowPlaying: { title: string; artist: string } | null
}

/**
 * Turn-by-turn beside a map that follows the phone. Passive while driving: the
 * dial stays volume and its press stays play/pause; back closes it.
 */
export function NavScreen({ onClose, nowPlaying }: Props) {
  const nav = useNav()
  const route = useNavRoute(nav.route_rev)

  return (
    <div className={styles.screen} role="dialog" aria-label="Navigation">
      {nav.connected ? (
        <Suspense fallback={<div className={styles.mapOff} />}>
          <NavMap location={nav.location} route={route?.points} />
        </Suspense>
      ) : (
        <div className={styles.mapOff} />
      )}

      {nav.connected ? <Speedo nav={nav} /> : null}

      <aside className={styles.panel}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Back">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0z" />
          </svg>
        </button>

        {!nav.connected ? (
          <div className={styles.hint}>
            <strong>Needs the Wisp app</strong>
            <span>
              Directions come from the Wisp app on your phone, with notification and location
              access. Spotify works without it.
            </span>
          </div>
        ) : nav.active ? (
          <>
            <TurnCard nav={nav} />
            <TripChips nav={nav} />
          </>
        ) : (
          <div className={styles.hint}>
            <strong>Not navigating</strong>
            <span>Start directions in Google Maps on your phone and they'll show up here.</span>
          </div>
        )}

        {nowPlaying ? (
          <div className={styles.music}>
            <span className={styles.musicTitle}>{nowPlaying.title}</span>
            <span className={styles.musicArtist}>{nowPlaying.artist}</span>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
