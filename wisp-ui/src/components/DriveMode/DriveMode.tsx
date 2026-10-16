import { memo, useEffect, useState, type CSSProperties } from 'react'
import { useDial } from '@/components/Home/useDial'
import {
  pauseDrive,
  startDrive,
  stopDrive,
  useDriveState,
  type DriveGenre,
  type DriveParts,
  type DriveState,
} from '@/api/drive'
import { GENRES, genreLook } from './genres'
import styles from './DriveMode.module.scss'

interface Props {
  onClose: () => void
}

type Stage = 'warning' | 'pick' | 'drive'

const PART_ORDER: Array<{ key: keyof DriveParts; label: string }> = [
  { key: 'drums', label: 'Drums' },
  { key: 'bass', label: 'Bass' },
  { key: 'melody', label: 'Melody' },
  { key: 'choir', label: 'Choir' },
]

/**
 * Drive Mode, from Settings: a warning first (it's a beta and uses the phone's
 * battery), then the genre, then the drive itself with its glowing bar.
 * The knob moves and presses, back steps out.
 */
function DriveModeImpl({ onClose }: Props) {
  const [stage, setStage] = useState<Stage>('warning')
  const [okFocused, setOkFocused] = useState(true)
  const [pick, setPick] = useState(0)
  const [genre, setGenre] = useState<DriveGenre | null>(null)
  const [paused, setPaused] = useState(false)
  // the Car Thing has no phone app to play it on
  const [noPhone, setNoPhone] = useState(false)

  const leave = () => {
    if (genre) void stopDrive()
    onClose()
  }

  const choose = (i: number) => {
    const g = GENRES[i].id
    setGenre(g)
    setPaused(false)
    setStage('drive')
    setNoPhone(false)
    // the desk preview has no phone and simulates one instead
    void startDrive(g).then((ok) => setNoPhone(!ok && !import.meta.env.DEV))
  }

  const togglePause = () => {
    // nothing to pause yet: the press tries the phone again
    if (noPhone && genre) {
      setNoPhone(false)
      void startDrive(genre).then((ok) => setNoPhone(!ok))
      return
    }
    const next = !paused
    setPaused(next)
    void pauseDrive(next)
  }

  useDial({
    onStep: (dir) => {
      if (stage === 'warning') setOkFocused(dir > 0 ? false : true)
      else if (stage === 'pick') setPick((p) => Math.max(0, Math.min(GENRES.length - 1, p + dir)))
    },
    onPress: () => {
      if (stage === 'warning') {
        if (okFocused) setStage('pick')
        else onClose()
      } else if (stage === 'pick') choose(pick)
      else togglePause()
    },
    onBack: () => {
      if (stage === 'drive') {
        void stopDrive()
        setGenre(null)
        setStage('pick')
      } else onClose()
    },
  })

  return (
    <div className={styles.root} role="dialog" aria-label="Drive Mode">
      {stage === 'warning' ? (
        <Warning
          okFocused={okFocused}
          onOk={() => setStage('pick')}
          onCancel={onClose}
        />
      ) : stage === 'pick' ? (
        <Picker selected={pick} onSelect={setPick} onChoose={choose} onBack={onClose} />
      ) : genre ? (
        <Drive
          genre={genre}
          paused={paused}
          noPhone={noPhone}
          onPhonePaused={setPaused}
          onTogglePause={togglePause}
          onLeave={leave}
        />
      ) : null}
    </div>
  )
}

function Warning({
  okFocused,
  onOk,
  onCancel,
}: {
  okFocused: boolean
  onOk: () => void
  onCancel: () => void
}) {
  return (
    <div className={styles.warning}>
      <div className={styles.warnCard}>
        <div className={styles.warnHead}>
          <span className={styles.warnIcon} aria-hidden>
            <WarnIcon />
          </span>
          <span className={styles.warnTitle}>Drive Mode is in beta</span>
        </div>
        <p className={styles.warnBody}>
          Music that follows your driving: calm when you're stopped, opening up as you speed up.
          It's still being tuned, and it uses your phone's GPS and motion sensors the whole time,
          so it can use a lot of battery: keep your phone charging. The first time you pick a
          sound, its music downloads to your phone (about 26 MB, once), which uses data if
          you're not on Wi-Fi.
        </p>
        <div className={styles.warnButtons}>
          <button
            type="button"
            className={`${styles.btn} ${!okFocused ? styles.btnFocus : ''}`}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${okFocused ? styles.btnFocus : ''}`}
            onClick={onOk}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

function Picker({
  selected,
  onSelect,
  onChoose,
  onBack,
}: {
  selected: number
  onSelect: (i: number) => void
  onChoose: (i: number) => void
  onBack: () => void
}) {
  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <div className={styles.title}>Drive Mode</div>
        <span className={styles.beta}>Beta</span>
      </div>
      <div className={styles.hint}>Choose a sound</div>
      <div className={styles.covers}>
        {GENRES.map((g, i) => (
          <button
            key={g.id}
            type="button"
            className={`${styles.coverItem} ${i === selected ? styles.coverSelected : ''}`}
            onClick={() => (i === selected ? onChoose(i) : onSelect(i))}
            onDoubleClick={() => onChoose(i)}
            aria-label={`${g.name}: ${g.blurb}`}
          >
            <span
              className={styles.cover}
              style={{ background: g.cover, '--glow': g.glowRgb } as CSSProperties}
            >
              <span className={styles.coverName}>{g.name}</span>
            </span>
            <span className={styles.coverBlurb}>{g.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Drive({
  genre,
  paused,
  noPhone,
  onPhonePaused,
  onTogglePause,
  onLeave,
}: {
  genre: DriveGenre
  paused: boolean
  noPhone: boolean
  /** paused or played from the car's own buttons: the screen follows */
  onPhonePaused: (paused: boolean) => void
  onTogglePause: () => void
  onLeave: () => void
}) {
  const look = genreLook(genre)
  const state = useDriveState(true, genre)
  // a little while with no word from the phone before saying so
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 4000)
    return () => window.clearTimeout(t)
  }, [])

  const phonePaused = state?.paused
  useEffect(() => {
    if (phonePaused !== undefined && phonePaused !== paused) onPhonePaused(phonePaused)
    // only the phone's word changing matters here, not this screen's own presses
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phonePaused])

  const live = state !== null && !paused && !state.preparing && !state.error
  const level = live ? state.level : 0
  const vars = {
    '--glow': look.glowRgb,
    '--glow-a': look.glow[0],
    '--glow-b': look.glow[1],
  } as CSSProperties

  return (
    <div className={styles.drive} style={vars}>
      <div className={styles.driveBackdrop} style={{ background: look.cover }} />
      <div className={styles.driveScrim} style={{ opacity: 0.82 - 0.3 * level }} />
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onLeave} aria-label="Leave Drive Mode">
          <BackIcon />
        </button>
        <div className={styles.title}>{look.name}</div>
        <span className={styles.beta}>Beta</span>
        <span className={styles.speed}>
          {state?.speed_mph !== undefined ? (
            <>
              <span className={styles.speedNum}>{state.speed_mph}</span> mph
            </>
          ) : null}
        </span>
      </div>

      <div className={styles.stage}>
        <div className={styles.barTrack}>
          <div
            className={styles.barFill}
            style={{
              width: `${Math.max(level, 0.02) * 100}%`,
              boxShadow:
                `0 0 ${10 + 30 * level}px rgba(${look.glowRgb}, ${0.35 + 0.5 * level}),` +
                `0 0 ${30 + 70 * level}px rgba(${look.glowRgb}, ${0.15 + 0.35 * level})`,
            }}
          />
        </div>
        <div className={styles.parts}>
          {PART_ORDER.map(({ key, label }) => {
            const v = live ? state.parts[key] : 0
            return (
              <div
                key={key}
                className={`${styles.part} ${v > 0.5 ? styles.partOn : ''}`}
                style={{ opacity: 0.4 + 0.6 * v }}
              >
                <div className={styles.partMeter}>
                  <div className={styles.partFill} style={{ height: `${v * 100}%` }} />
                </div>
                <span className={styles.partLabel}>{label}</span>
              </div>
            )
          })}
        </div>
        <div className={styles.status}>{statusLine(state, paused, noPhone, waited)}</div>
      </div>

      <button type="button" className={styles.pause} onClick={onTogglePause}>
        {noPhone ? 'Try again' : paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  )
}

/** what the drive is doing, in a line under the meters */
function statusLine(
  state: DriveState | null,
  paused: boolean,
  noPhone: boolean,
  waited: boolean,
): string {
  if (noPhone) return 'Drive Mode needs the Wisp app on your phone. Open it, then press to try again'
  if (paused || state?.paused) return 'Paused'
  if (!state) return waited ? 'Waiting for your phone…' : 'Starting…'
  if (state.error) return state.error
  if (state.download !== undefined) return `Downloading the music to your phone… ${state.download}%`
  if (state.preparing) return 'Getting the music ready (the first time takes a moment)…'
  if (!state.playing) return 'Drive Mode stopped on the phone'
  if (state.gps === false) return 'Waiting for GPS · the music stays calm until then'
  if (state.clarity < 0.15) return 'Stopped · the music waits in the distance'
  if (state.clarity > 0.8) return 'Everything playing'
  return 'Opening up as you go'
}

function BackIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0z" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5 1.5 21h21L12 2.5zm0 5.5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 8.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z" />
    </svg>
  )
}

export const DriveMode = memo(DriveModeImpl)
