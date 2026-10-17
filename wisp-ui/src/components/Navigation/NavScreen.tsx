import { lazy, Suspense, useState } from 'react'
import { stopNav } from '@/api/nav'
import { useNav } from '@/hooks/navContext'
import { updateSettings, useSettings, type NavVoice } from '@/settings'
import { useNavRoute } from './useNavRoute'
import { ManeuverIcon } from './ManeuverIcon'
import { Planner } from './Planner'
import { parseTrip } from './trip'
import { Speedo } from './TripInfo'
import styles from './Navigation.module.scss'

// Leaflet is a sizeable script the Car Thing would otherwise parse at every boot
// for a screen that's rarely open; it loads the first time the map is
const NavMap = lazy(() => import('./NavMap').then((m) => ({ default: m.NavMap })))

interface Props {
  onClose: () => void
  /** the song underneath, so the map doesn't hide what's playing */
  nowPlaying: { title: string; artist: string } | null
}

const VOICE: { id: NavVoice; label: string; sub: string }[] = [
  { id: 'all', label: 'Every turn', sub: 'A heads-up, then the turn' },
  { id: 'turns', label: 'Just the turns', sub: 'Only as each one comes' },
  { id: 'off', label: 'Muted', sub: 'On screen only' },
]

/**
 * Directions on a map that follows the phone: the next turn big at the top,
 * the one after under it, and the time, miles and arrival along the bottom.
 * Passive while driving: the dial stays volume and its press play/pause; back
 * closes it. Wisp's own directions add a sound menu and Stop (touch). With
 * nothing navigating it's "Where to?" (Planner), which the knob drives.
 */
export function NavScreen({ onClose, nowPlaying }: Props) {
  const nav = useNav()
  const route = useNavRoute(nav.route_rev)
  const { navVoice } = useSettings()
  const [soundOpen, setSoundOpen] = useState(false)

  if (nav.connected && !nav.active) return <Planner location={nav.location} onClose={onClose} />

  const trip = parseTrip(nav.sub_text)
  const time = trip.find((p) => p.kind === 'time')?.text
  const dist = trip.find((p) => p.kind === 'distance')?.text
  const arrive = trip.find((p) => p.kind === 'arrival')?.text
  const arrived = nav.own && nav.maneuver === 'arrive' && nav.title === 'Arrived'

  return (
    <div className={styles.screen} role="dialog" aria-label="Navigation">
      {nav.connected ? (
        <Suspense fallback={<div className={styles.mapOff} />}>
          <NavMap location={nav.location} route={route?.points} />
        </Suspense>
      ) : (
        <div className={styles.mapOff} />
      )}

      <button type="button" className={styles.back} onClick={onClose} aria-label="Back">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0z" />
        </svg>
      </button>

      {!nav.connected ? (
        <div className={styles.hintCard}>
          <strong>Needs the Wisp app</strong>
          <span>
            Directions need the Wisp app on your phone, with location access. Spotify works without
            it.
          </span>
        </div>
      ) : (
        <>
          <div className={`${styles.turnBig} ${arrived ? styles.turnArrived : ''}`}>
            <div className={styles.turnRow}>
              <span className={styles.turnArrow}>
                {nav.icon ? <img src={nav.icon} alt="" /> : <ManeuverIcon kind={nav.maneuver} />}
              </span>
              {nav.title ? <span className={styles.turnDist}>{nav.title}</span> : null}
            </div>
            {nav.text ? <div className={styles.turnWhat}>{nav.text}</div> : null}
          </div>
          {nav.then && !arrived ? (
            <div className={styles.thenChip}>
              Then <ManeuverIcon kind={nav.then_maneuver} size={22} /> {nav.then}
            </div>
          ) : null}
          <Speedo nav={nav} />

          <div className={styles.tripBar}>
            {time ? <span className={styles.tripEta}>{time}</span> : null}
            <span className={styles.tripMeta}>
              {dist ? <b>{dist}</b> : null}
              {dist && arrive ? ' · ' : null}
              {arrive ? (
                <>
                  arrive <b>{arrive}</b>
                </>
              ) : null}
              {nowPlaying ? (
                <span className={styles.tripSong}>
                  <span>{nowPlaying.title}</span>
                  <span className={styles.tripArtist}>{nowPlaying.artist}</span>
                </span>
              ) : null}
            </span>
            {nav.own ? (
              <>
                <button
                  type="button"
                  className={`${styles.roundBtn} ${soundOpen ? styles.on : ''}`}
                  onClick={() => setSoundOpen((o) => !o)}
                  aria-label="Spoken directions"
                  aria-expanded={soundOpen}
                >
                  <SoundIcon mode={navVoice} />
                </button>
                <button type="button" className={styles.stopBtn} onClick={() => void stopNav()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                  </svg>
                  Stop
                </button>
              </>
            ) : null}
          </div>

          {soundOpen && nav.own ? (
            <div className={styles.soundSheet} role="menu" aria-label="Spoken directions">
              <div className={styles.soundHead}>Spoken directions</div>
              {VOICE.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={navVoice === v.id}
                  className={`${styles.soundOpt} ${navVoice === v.id ? styles.on : ''}`}
                  onClick={() => {
                    updateSettings({ navVoice: v.id })
                    setSoundOpen(false)
                  }}
                >
                  <SoundIcon mode={v.id} />
                  <span>
                    {v.label}
                    <small>{v.sub}</small>
                  </span>
                  {navVoice === v.id ? <span className={styles.check}>✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function SoundIcon({ mode }: { mode: NavVoice }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9v6h4l5 4V5L8 9z" />
      {mode === 'all' ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : null}
      {mode === 'turns' ? <path d="M16.5 9.5a3.5 3.5 0 0 1 0 5" /> : null}
      {mode === 'off' ? <path d="m17 9 5 6M22 9l-5 6" /> : null}
    </svg>
  )
}
